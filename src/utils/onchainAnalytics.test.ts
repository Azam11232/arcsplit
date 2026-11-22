import { describe, expect, it, vi } from 'vitest'
import { encodeAbiParameters, parseAbiItem, toEventSelector } from 'viem'
import type { Address, Hash, Hex, PublicClient } from 'viem'
import { calculateSplitAnalytics } from './analytics'
import {
  createBlockRanges,
  mergeOnchainAndLocalHistory,
  readOnchainScanCache,
  scanOnchainDistributions,
  verifyDistributionReceipt,
} from './onchainAnalytics'
import type { SplitHistoryEntry } from './splitStorage'

const distributedEvent = parseAbiItem(
  'event Distributed(address indexed payer, uint256 totalAmount, uint256 recipientCount)',
)
const recipientPayoutEvent = parseAbiItem(
  'event RecipientPayout(address indexed recipient, uint256 amount)',
)
const payer: Address = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const alice: Address = '0x1111111111111111111111111111111111111111'
const bob: Address = '0x2222222222222222222222222222222222222222'
const contract: Address = '0x3333333333333333333333333333333333333333'
const txHash: Hash = `0x${'a'.repeat(64)}`
const blockHash: Hash = `0x${'c'.repeat(64)}`
const timestamp = 1_760_000_000n

function createMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) },
  }
}

function topicsTuple(topics: readonly Hex[]): [Hex, ...Hex[]] {
  const [first, ...rest] = topics
  if (!first) throw new Error('Encoded test log has no event topic.')
  return [first, ...rest]
}

function encodedDistributedLog(
  address: Address,
  hash: Hash,
  blockNumber: bigint,
  args: { payer: Address; totalAmount: bigint; recipientCount: bigint },
  logIndex = 0,
) {
  return {
    address,
    blockNumber,
    blockHash,
    logIndex,
    transactionHash: hash,
    data: encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }],
      [args.totalAmount, args.recipientCount],
    ),
    topics: topicsTuple([
      toEventSelector(distributedEvent),
      encodeAbiParameters([{ type: 'address' }], [args.payer]),
    ]),
  }
}

function encodedPayoutLog(
  address: Address,
  hash: Hash,
  blockNumber: bigint,
  recipient: Address,
  amount: bigint,
  logIndex = 1,
) {
  return {
    address,
    blockNumber,
    logIndex,
    transactionHash: hash,
    data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
    topics: topicsTuple([
      toEventSelector(recipientPayoutEvent),
      encodeAbiParameters([{ type: 'address' }], [recipient]),
    ]),
  }
}

function fixtureEvent(address = contract, hash = txHash, blockNumber = 13n) {
  return encodedDistributedLog(address, hash, blockNumber, {
    payer,
    totalAmount: 1_500_000n,
    recipientCount: 2n,
  }, 3)
}

function fixtureReceipt(
  event = fixtureEvent(),
  options: { status?: 'success' | 'reverted'; recipientTotal?: bigint } = {},
) {
  return {
    transactionHash: event.transactionHash,
    blockNumber: event.blockNumber,
    blockHash: event.blockHash,
    status: options.status ?? 'success',
    to: event.address,
    logs: [
      encodedPayoutLog(event.address, event.transactionHash, event.blockNumber, alice, 1_000_000n, 1),
      encodedPayoutLog(event.address, event.transactionHash, event.blockNumber, bob, options.recipientTotal ?? 500_000n, 2),
      event,
    ],
  }
}

describe('on-chain ArcSplit analytics', () => {
  it('creates bounded, inclusive block ranges without gaps', () => {
    expect(createBlockRanges(10n, 25n, 6n)).toEqual([
      { fromBlock: 10n, toBlock: 15n },
      { fromBlock: 16n, toBlock: 21n },
      { fromBlock: 22n, toBlock: 25n },
    ])
    expect(createBlockRanges(0n, 20_001n)).toEqual([
      { fromBlock: 0n, toBlock: 9_999n },
      { fromBlock: 10_000n, toBlock: 19_999n },
      { fromBlock: 20_000n, toBlock: 20_001n },
    ])
    expect(() => createBlockRanges(4n, 3n)).toThrow(/invalid/i)
  })

  it('accepts a successful receipt only when event payouts reconcile exactly', () => {
    const event = fixtureEvent()
    const record = verifyDistributionReceipt(
      event,
      fixtureReceipt(event),
      { timestamp, hash: blockHash },
      payer,
      { chainId: 5042, networkName: 'Arc Mainnet', contractAddress: contract },
    )

    expect(record).toMatchObject({
      chainId: 5042,
      networkName: 'Arc Mainnet',
      txHash,
      blockNumber: 13n,
      logIndex: 3,
      createdAt: Number(timestamp * 1_000n),
      totalRaw: '1500000',
      status: 'success',
      recipients: [
        { address: alice, amountRaw: '1000000' },
        { address: bob, amountRaw: '500000' },
      ],
    })
    expect(record.payer.toLowerCase()).toBe(payer.toLowerCase())

    expect(() => verifyDistributionReceipt(
      event,
      fixtureReceipt(event, { status: 'reverted' }),
      { timestamp, hash: blockHash },
      payer,
      { chainId: 5042, networkName: 'Arc Mainnet', contractAddress: contract },
    )).toThrow(/successful receipt/i)
    expect(() => verifyDistributionReceipt(
      event,
      fixtureReceipt(event, { recipientTotal: 400_000n }),
      { timestamp, hash: blockHash },
      payer,
      { chainId: 5042, networkName: 'Arc Mainnet', contractAddress: contract },
    )).toThrow(/reconcile/i)
    expect(() => verifyDistributionReceipt(
      event,
      fixtureReceipt(event),
      { timestamp, hash: `0x${'d'.repeat(64)}` },
      payer,
      { chainId: 5042, networkName: 'Arc Mainnet', contractAddress: contract },
    )).toThrow(/canonical/i)
  })

  it('scans paginated logs, retries smaller ranges for RPC limits, and aggregates verified timestamps', async () => {
    const event = fixtureEvent(contract, txHash, 13n)
    const receipt = fixtureReceipt(event)
    const requests: Array<{ fromBlock: bigint; toBlock: bigint }> = []
    const client = {
      getBlockNumber: vi.fn(() => Promise.resolve(20n)),
      getBytecode: vi.fn(({ blockNumber }: { blockNumber: bigint }) =>
        Promise.resolve(        blockNumber >= 10n ? '0x6000' : '0x')),
      getLogs: vi.fn(({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        requests.push({ fromBlock, toBlock })
        if (toBlock - fromBlock > 2n) return Promise.reject(new Error('requested range too large'))
        return Promise.resolve(fromBlock <= 13n && toBlock >= 13n ? [event] : [])
      }),
      getTransactionReceipt: vi.fn(() => Promise.resolve(receipt)),
      getBlock: vi.fn(({ blockNumber }: { blockNumber: bigint }) => Promise.resolve({
        timestamp: blockNumber === 10n ? 1_750_000_000n : timestamp,
        hash: blockHash,
      })),
    } as unknown as PublicClient
    const progress: Array<{ phase: string; blocksScanned: bigint }> = []

    const result = await scanOnchainDistributions(client, {
      chainId: 5042,
      networkName: 'Arc Mainnet',
      contractAddress: contract,
      payer,
      onProgress: (item) => progress.push({ phase: item.phase, blocksScanned: item.blocksScanned }),
    })

    expect(result.coverage).toEqual({
      deploymentBlock: 10n,
      deploymentTimestamp: 1_750_000_000_000,
      scannedThroughBlock: 20n,
      scannedThroughHash: blockHash,
    })
    expect(result.records).toHaveLength(1)
    expect(result.records[0]?.txHash).toBe(txHash)
    expect(requests.length).toBeGreaterThan(1)
    expect(progress.some((item) => item.phase === 'verifying' && item.blocksScanned === 11n)).toBe(true)
    expect(calculateSplitAnalytics(result.records).totalRaw).toBe(1_500_000n)
    expect(calculateSplitAnalytics(result.records).weekly[0]?.totalRaw).toBe(1_500_000n)
  })

  it('keeps separate distributions emitted in one transaction and aggregates each event once', async () => {
    const multiCallContract: Address = '0x7777777777777777777777777777777777777777'
    const sharedHash: Hash = `0x${'c'.repeat(64)}`
    const first = encodedDistributedLog(multiCallContract, sharedHash, 13n, {
      payer,
      totalAmount: 1_500_000n,
      recipientCount: 2n,
    }, 3)
    const second = encodedDistributedLog(multiCallContract, sharedHash, 13n, {
      payer,
      totalAmount: 700_000n,
      recipientCount: 1n,
    }, 5)
    const receipt = {
      transactionHash: sharedHash,
      blockNumber: 13n,
      blockHash,
      status: 'success' as const,
      to: '0x8888888888888888888888888888888888888888' as Address,
      logs: [
        encodedPayoutLog(multiCallContract, sharedHash, 13n, alice, 1_000_000n, 1),
        encodedPayoutLog(multiCallContract, sharedHash, 13n, bob, 500_000n, 2),
        first,
        encodedPayoutLog(multiCallContract, sharedHash, 13n, alice, 700_000n, 4),
        second,
      ],
    }
    const client = {
      getBlockNumber: vi.fn(() => Promise.resolve(20n)),
      getBytecode: vi.fn(({ blockNumber }: { blockNumber: bigint }) =>
        Promise.resolve(        blockNumber >= 10n ? '0x6000' : '0x')),
      getLogs: vi.fn(() => Promise.resolve([first, second])),
      getTransactionReceipt: vi.fn(() => Promise.resolve(receipt)),
      getBlock: vi.fn(() => Promise.resolve({ timestamp, hash: blockHash })),
    } as unknown as PublicClient

    const result = await scanOnchainDistributions(client, {
      chainId: 5042,
      networkName: 'Arc Mainnet',
      contractAddress: multiCallContract,
      payer,
    })

    expect(result.records.map((record) => [record.logIndex, record.totalRaw])).toEqual([
      [3, '1500000'],
      [5, '700000'],
    ])
    expect(calculateSplitAnalytics(result.records).totalRaw).toBe(2_200_000n)
    expect(result.records.map((record) => record.id)).toHaveLength(2)
    expect(client.getTransactionReceipt).toHaveBeenCalledOnce()
  })

  it('does not expose local records as on-chain analytics and deduplicates matching hashes', () => {
    const event = fixtureEvent()
    const onchain = verifyDistributionReceipt(
      event,
      fixtureReceipt(event),
      { timestamp, hash: blockHash },
      payer,
      { chainId: 5042, networkName: 'Arc Mainnet', contractAddress: contract },
    )
    const local: SplitHistoryEntry[] = [
      {
        id: 'matching',
        txHash,
        chainId: 5042,
        status: 'success',
        contractAddress: contract,
        mode: 'fixed',
        totalRaw: '1500000',
        recipients: [{ address: alice, amountRaw: '1500000' }],
        createdAt: 1,
      },
      {
        id: 'local-only',
        txHash: `0x${'b'.repeat(64)}`,
        chainId: 5042,
        status: 'failed',
        mode: 'fixed',
        totalRaw: '9000000',
        recipients: [{ address: bob, amountRaw: '9000000' }],
        createdAt: 2,
      },
    ]

    const merged = mergeOnchainAndLocalHistory([onchain], local, 'Arc Mainnet')
    expect(merged.records).toHaveLength(2)
    expect(merged.records.find((record) => record.source === 'on-chain')).toMatchObject({
      totalRaw: '1500000',
      alsoSavedLocally: true,
    })
    expect(merged.localOnly).toHaveLength(1)
    expect(merged.localOnly[0]).toMatchObject({
      id: 'local-only',
      status: 'failed',
      source: 'local',
    })
    expect(calculateSplitAnalytics([onchain]).totalRaw).toBe(1_500_000n)
  })

  it('isolates cached checkpoints by chain, contract, and wallet and discards malformed records', () => {
    const storage = createMemoryStorage()
    const event = fixtureEvent()
    const verified = verifyDistributionReceipt(
      event,
      fixtureReceipt(event),
      { timestamp, hash: blockHash },
      payer,
      { chainId: 5042, networkName: 'Arc Mainnet', contractAddress: contract },
    )
    const key = `arcsplit:onchain-analytics:v1:5042:${contract}:${payer}`
    storage.setItem(key, JSON.stringify({
      version: 1,
      complete: true,
      chainId: 5042,
      contractAddress: contract,
      payer,
      deploymentBlock: '10',
      scannedThroughBlock: '20',
      scannedThroughHash: blockHash,
      records: [{ ...verified, blockNumber: verified.blockNumber.toString() }],
    }))

    expect(readOnchainScanCache({
      chainId: 5042,
      networkName: 'Arc Mainnet',
      contractAddress: contract,
      payer,
    }, storage).snapshot?.records).toHaveLength(1)
    expect(readOnchainScanCache({
      chainId: 5042002,
      networkName: 'Arc Testnet',
      contractAddress: contract,
      payer,
    }, storage).snapshot).toBeUndefined()
    expect(readOnchainScanCache({
      chainId: 5042,
      networkName: 'Arc Mainnet',
      contractAddress: contract,
      payer: alice,
    }, storage).snapshot).toBeUndefined()

    storage.setItem(key, JSON.stringify({
      version: 1,
      complete: true,
      chainId: 5042,
      contractAddress: contract,
      payer,
      deploymentBlock: '10',
      scannedThroughBlock: '20',
      scannedThroughHash: blockHash,
      records: [{ ...verified, blockNumber: '13', verificationStatus: 'unverified' }],
    }))
    const invalid = readOnchainScanCache({
      chainId: 5042,
      networkName: 'Arc Mainnet',
      contractAddress: contract,
      payer,
    }, storage)
    expect(invalid.snapshot).toBeUndefined()
    expect(invalid.warning).toMatch(/invalid/i)
    expect(storage.getItem(key)).toBeNull()
  })

  it('resumes a persisted verified checkpoint at the next block without rediscovering deployment', async () => {
    const storage = createMemoryStorage()
    const incrementalContract: Address = '0x6666666666666666666666666666666666666666'
    vi.stubGlobal('localStorage', storage)
    try {
      const event = fixtureEvent(incrementalContract)
      const verified = verifyDistributionReceipt(
        event,
        fixtureReceipt(event),
        { timestamp, hash: blockHash },
        payer,
        { chainId: 5042, networkName: 'Arc Mainnet', contractAddress: incrementalContract },
      )
      storage.setItem(`arcsplit:onchain-analytics:v1:5042:${incrementalContract}:${payer}`, JSON.stringify({
        version: 1,
        complete: true,
        chainId: 5042,
        contractAddress: incrementalContract,
        payer,
        deploymentBlock: '10',
        scannedThroughBlock: '20',
        scannedThroughHash: blockHash,
        records: [{ ...verified, blockNumber: verified.blockNumber.toString() }],
      }))
      const latestHash: Hash = `0x${'d'.repeat(64)}`
      const client = {
        getBlockNumber: vi.fn(() => Promise.resolve(25n)),
        getBlock: vi.fn(({ blockNumber }: { blockNumber: bigint }) => Promise.resolve({
          timestamp,
          hash: blockNumber === 20n ? blockHash : latestHash,
        })),
        getBytecode: vi.fn(() => Promise.reject(new Error('deployment discovery should not run'))),
        getLogs: vi.fn((parameters: { fromBlock: bigint; toBlock: bigint }) => {
          expect(parameters).toMatchObject({ fromBlock: 21n, toBlock: 25n })
          return Promise.resolve([])
        }),
      } as unknown as PublicClient

      const result = await scanOnchainDistributions(client, {
        chainId: 5042,
        networkName: 'Arc Mainnet',
        contractAddress: incrementalContract,
        payer,
      })

      expect(client.getBytecode).not.toHaveBeenCalled()
      expect(client.getLogs).toHaveBeenCalledOnce()
      expect(result.records).toHaveLength(1)
      expect(result.coverage).toEqual({
        deploymentBlock: 10n,
        deploymentTimestamp: Number(timestamp) * 1_000,
        scannedThroughBlock: 25n,
        scannedThroughHash: latestHash,
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('discards a reorganized checkpoint and completes a full rescan before replacing it', async () => {
    const storage = createMemoryStorage()
    const reorgContract: Address = '0x8888888888888888888888888888888888888888'
    vi.stubGlobal('localStorage', storage)
    try {
      const event = fixtureEvent(reorgContract)
      const verified = verifyDistributionReceipt(
        event,
        fixtureReceipt(event),
        { timestamp, hash: blockHash },
        payer,
        { chainId: 5042, networkName: 'Arc Mainnet', contractAddress: reorgContract },
      )
      const key = `arcsplit:onchain-analytics:v1:5042:${reorgContract}:${payer}`
      storage.setItem(key, JSON.stringify({
        version: 1,
        complete: true,
        chainId: 5042,
        contractAddress: reorgContract,
        payer,
        deploymentBlock: '10',
        scannedThroughBlock: '20',
        scannedThroughHash: blockHash,
        records: [{ ...verified, blockNumber: verified.blockNumber.toString() }],
      }))
      const canonicalHash: Hash = `0x${'e'.repeat(64)}`
      const client = {
        getBlockNumber: vi.fn(() => Promise.resolve(25n)),
        getBlock: vi.fn(({ blockNumber }: { blockNumber: bigint }) => Promise.resolve({
          timestamp,
          hash: blockNumber === 20n ? `0x${'d'.repeat(64)}` : canonicalHash,
        })),
        getBytecode: vi.fn(({ blockNumber }: { blockNumber: bigint }) =>
          Promise.resolve(          blockNumber >= 10n ? '0x6000' : '0x')),
        getLogs: vi.fn((parameters: { fromBlock: bigint; toBlock: bigint }) => {
          expect(parameters).toMatchObject({ fromBlock: 10n, toBlock: 25n })
          return Promise.resolve([])
        }),
      } as unknown as PublicClient

      const result = await scanOnchainDistributions(client, {
        chainId: 5042,
        networkName: 'Arc Mainnet',
        contractAddress: reorgContract,
        payer,
      })

      expect(result.records).toEqual([])
      expect(result.cacheWarning).toMatch(/full rescan was performed/i)
      expect(client.getLogs).toHaveBeenCalledOnce()
      expect(readOnchainScanCache({
        chainId: 5042,
        networkName: 'Arc Mainnet',
        contractAddress: reorgContract,
        payer,
      }, storage).snapshot?.records).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('retries transient RPC failures and times out stalled requests without returning partial results', async () => {
    const address = '0x5555555555555555555555555555555555555555' as Address
    const getLogs = vi.fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce([])
    const client = {
      getBlockNumber: vi.fn(() => Promise.resolve(10n)),
      getBlock: vi.fn(() => Promise.resolve({ timestamp, hash: blockHash })),
      getBytecode: vi.fn(() => Promise.resolve('0x6000' as Hex)),
      getLogs,
    } as unknown as PublicClient

    const result = await scanOnchainDistributions(client, {
      chainId: 5042,
      networkName: 'Arc Mainnet',
      contractAddress: address,
      payer,
    })
    expect(result.coverage.scannedThroughBlock).toBe(10n)
    expect(getLogs).toHaveBeenCalledTimes(2)

    vi.useFakeTimers()
    try {
      const stalledClient = {
        getBlockNumber: vi.fn(() => new Promise<bigint>(() => {})),
      } as unknown as PublicClient
      const stalledScan = scanOnchainDistributions(stalledClient, {
        chainId: 5042,
        networkName: 'Arc Mainnet',
        contractAddress: address,
        payer: alice,
      })
      const timedOutScan = expect(stalledScan).rejects.toThrow(/timed out after 12 seconds/i)

      await vi.advanceTimersByTimeAsync(12_000)
      await vi.advanceTimersByTimeAsync(250)
      await vi.advanceTimersByTimeAsync(12_000)

      await timedOutScan
      expect(stalledClient.getBlockNumber).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails the whole scan rather than returning an incomplete result after an RPC error', async () => {
    const address = '0x5555555555555555555555555555555555555555' as Address
    const storage = createMemoryStorage()
    vi.stubGlobal('localStorage', storage)
    const cacheKey = `arcsplit:onchain-analytics:v1:5042002:${address}:${payer}`
    const getLogs = vi.fn()
      .mockRejectedValueOnce(new Error('historical log service unavailable'))
      .mockRejectedValueOnce(new Error('historical log service unavailable'))
      .mockResolvedValueOnce([])
    const client = {
      getBlockNumber: vi.fn(() => Promise.resolve(10n)),
      getBlock: vi.fn(() => Promise.resolve({ timestamp, hash: blockHash })),
      getBytecode: vi.fn(() => Promise.resolve('0x6000' as Hex)),
      getLogs,
    } as unknown as PublicClient

    try {
      const options = {
        chainId: 5042002,
        networkName: 'Arc Testnet',
        contractAddress: address,
        payer,
      }
      await expect(scanOnchainDistributions(client, options))
        .rejects.toThrow(/could not scan ArcSplit event logs/i)
      expect(storage.getItem(cacheKey)).toBeNull()
      expect(getLogs).toHaveBeenCalledTimes(2)

      const recovered = await scanOnchainDistributions(client, options)
      expect(recovered.coverage.scannedThroughBlock).toBe(10n)
      expect(storage.getItem(cacheKey)).not.toBeNull()
      expect(getLogs).toHaveBeenCalledTimes(3)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
