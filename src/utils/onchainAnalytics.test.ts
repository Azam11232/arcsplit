import { describe, expect, it, vi } from 'vitest'
import { encodeAbiParameters, parseAbiItem, toEventSelector } from 'viem'
import type { Address, Hash, Hex, PublicClient } from 'viem'
import { getArcNetwork } from './arcsplit'
import { calculateSplitAnalytics } from './analytics'
import {
  createBlockRanges,
  mergeOnchainAndLocalHistory,
  readOnchainScanCache,
  scanOnchainDistributions,
  verifyDistributionReceipt,
  verifyHistoryDistributionReceipt,
} from './onchainAnalytics'
import type { SplitHistoryEntry } from './splitStorage'

const distributedEvent = parseAbiItem(
  'event Distributed(address indexed payer, uint256 totalAmount, uint256 recipientCount)',
)
const recipientPayoutEvent = parseAbiItem(
  'event RecipientPayout(address indexed recipient, uint256 amount)',
)
const payer = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address
const alice = '0x1111111111111111111111111111111111111111' as Address
const bob = '0x2222222222222222222222222222222222222222' as Address
const contract = '0x3333333333333333333333333333333333333333' as Address
const txHash = `0x${'a'.repeat(64)}` as Hash
const blockHash = `0x${'c'.repeat(64)}` as Hash
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
    transactionHash: event.transactionHash!,
    blockNumber: event.blockNumber!,
    blockHash: event.blockHash!,
    status: options.status ?? 'success',
    to: event.address,
    logs: [
      encodedPayoutLog(event.address, event.transactionHash!, event.blockNumber!, alice, 1_000_000n, 1),
      encodedPayoutLog(event.address, event.transactionHash!, event.blockNumber!, bob, options.recipientTotal ?? 500_000n, 2),
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
      { timestamp, hash: `0x${'d'.repeat(64)}` as Hash },
      payer,
      { chainId: 5042, networkName: 'Arc Mainnet', contractAddress: contract },
    )).toThrow(/canonical/i)
  })

  it('scans paginated logs, retries smaller ranges for RPC limits, and aggregates verified timestamps', async () => {
    const event = fixtureEvent(contract, txHash, 13n)
    const receipt = fixtureReceipt(event)
    const requests: Array<{ fromBlock: bigint; toBlock: bigint }> = []
    const client = {
      getBlockNumber: vi.fn(async () => 20n),
      getBytecode: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) =>
        blockNumber >= 10n ? '0x6000' as Hex : '0x' as Hex),
      getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        requests.push({ fromBlock, toBlock })
        if (toBlock - fromBlock > 2n) throw new Error('requested range too large')
        return fromBlock <= 13n && toBlock >= 13n ? [event] : []
      }),
      getTransactionReceipt: vi.fn(async () => receipt),
      getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
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
    const multiCallContract = '0x7777777777777777777777777777777777777777' as Address
    const sharedHash = `0x${'c'.repeat(64)}` as Hash
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
      getBlockNumber: vi.fn(async () => 20n),
      getBytecode: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) =>
        blockNumber >= 10n ? '0x6000' as Hex : '0x' as Hex),
      getLogs: vi.fn(async () => [first, second]),
      getTransactionReceipt: vi.fn(async () => receipt),
      getBlock: vi.fn(async () => ({ timestamp, hash: blockHash })),
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

    const cached = readOnchainScanCache({
      chainId: 5042,
      networkName: 'Arc Mainnet',
      contractAddress: contract,
      payer,
    }, storage)
    expect(cached.snapshot?.records).toHaveLength(1)
    expect(cached.snapshot?.records[0]?.verificationStatus).toBe('unverified')
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
    const cachedUnverified = readOnchainScanCache({
      chainId: 5042,
      networkName: 'Arc Mainnet',
      contractAddress: contract,
      payer,
    }, storage)
    expect(cachedUnverified.snapshot?.records).toHaveLength(1)
    expect(cachedUnverified.snapshot?.records[0]?.verificationStatus).toBe('unverified')
  })

  it('resumes a persisted checkpoint only after validating deployment and cached receipts', async () => {
    const storage = createMemoryStorage()
    const incrementalContract = '0x6666666666666666666666666666666666666666' as Address
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
      const latestHash = `0x${'d'.repeat(64)}` as Hash
      const client = {
        getBlockNumber: vi.fn(async () => 25n),
        getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
          timestamp,
          hash: [10n, 13n, 20n].includes(blockNumber) ? blockHash : latestHash,
        })),
        getBytecode: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) =>
          blockNumber >= 10n ? '0x6000' as Hex : '0x'),
        getTransactionReceipt: vi.fn(async () => fixtureReceipt(event)),
        getLogs: vi.fn(async (parameters: { fromBlock: bigint; toBlock: bigint }) => {
          expect(parameters).toMatchObject({ fromBlock: 21n, toBlock: 25n })
          return []
        }),
      } as unknown as PublicClient

      const result = await scanOnchainDistributions(client, {
        chainId: 5042,
        networkName: 'Arc Mainnet',
        contractAddress: incrementalContract,
        payer,
      })

      expect(client.getBytecode).toHaveBeenCalled()
      expect(client.getTransactionReceipt).toHaveBeenCalledOnce()
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
    const reorgContract = '0x8888888888888888888888888888888888888888' as Address
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
      const canonicalHash = `0x${'e'.repeat(64)}` as Hash
      const client = {
        getBlockNumber: vi.fn(async () => 25n),
        getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
          timestamp,
          hash: blockNumber === 20n ? `0x${'d'.repeat(64)}` as Hash : canonicalHash,
        })),
        getBytecode: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) =>
          blockNumber >= 10n ? '0x6000' as Hex : '0x' as Hex),
        getLogs: vi.fn(async (parameters: { fromBlock: bigint; toBlock: bigint }) => {
          expect(parameters).toMatchObject({ fromBlock: 10n, toBlock: 25n })
          return []
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

  it('rejects a tampered cached record and rebuilds it from the original chain events', async () => {
    const storage = createMemoryStorage()
    const tamperedContract = '0x9999999999999999999999999999999999999999' as Address
    vi.stubGlobal('localStorage', storage)
    try {
      const event = fixtureEvent(tamperedContract)
      const verified = verifyDistributionReceipt(
        event,
        fixtureReceipt(event),
        { timestamp, hash: blockHash },
        payer,
        { chainId: 5042, networkName: 'Arc Mainnet', contractAddress: tamperedContract },
      )
      const key = `arcsplit:onchain-analytics:v1:5042:${tamperedContract}:${payer}`
      storage.setItem(key, JSON.stringify({
        version: 1,
        complete: true,
        chainId: 5042,
        contractAddress: tamperedContract,
        payer,
        deploymentBlock: '10',
        scannedThroughBlock: '20',
        scannedThroughHash: blockHash,
        records: [{
          ...verified,
          blockNumber: verified.blockNumber.toString(),
          totalRaw: '2000000',
          recipients: [
            { address: alice, amountRaw: '1500000' },
            { address: bob, amountRaw: '500000' },
          ],
        }],
      }))
      const latestHash = `0x${'d'.repeat(64)}` as Hash
      const client = {
        getBlockNumber: vi.fn(async () => 25n),
        getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
          timestamp,
          hash: [10n, 13n, 20n].includes(blockNumber) ? blockHash : latestHash,
        })),
        getBytecode: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) =>
          blockNumber >= 10n ? '0x6000' as Hex : '0x'),
        getTransactionReceipt: vi.fn(async () => fixtureReceipt(event)),
        getLogs: vi.fn(async (parameters: { fromBlock: bigint; toBlock: bigint }) => {
          expect(parameters).toMatchObject({ fromBlock: 10n, toBlock: 25n })
          return [event]
        }),
      } as unknown as PublicClient

      const result = await scanOnchainDistributions(client, {
        chainId: 5042,
        networkName: 'Arc Mainnet',
        contractAddress: tamperedContract,
        payer,
      })

      expect(result.records).toHaveLength(1)
      expect(result.records[0]?.totalRaw).toBe('1500000')
      expect(result.records[0]?.recipients).toEqual([
        { address: alice, amountRaw: '1000000' },
        { address: bob, amountRaw: '500000' },
      ])
      expect(result.cacheWarning).toMatch(/saved distribution record did not match/i)
      expect(client.getLogs).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('verifies saved history against matching ArcSplit events and rejects changed or missing events', async () => {
    const network = getArcNetwork(5042)!
    const event = fixtureEvent(network.contractAddress, txHash)
    const receipt = fixtureReceipt(event)
    const client = {
      chain: { id: 5042 },
      getTransaction: vi.fn(async () => ({
        hash: txHash,
        from: payer,
        to: network.contractAddress,
      })),
      getTransactionReceipt: vi.fn(async () => receipt),
      getBlock: vi.fn(async () => ({ timestamp, hash: blockHash })),
    } as unknown as PublicClient
    const savedEntry: SplitHistoryEntry = {
      id: 'history-entry',
      txHash,
      chainId: 5042,
      status: 'success',
      contractAddress: network.contractAddress,
      mode: 'fixed',
      totalRaw: '1500000',
      recipients: [
        { address: alice, amountRaw: '1000000' },
        { address: bob, amountRaw: '500000' },
      ],
      createdAt: Date.now(),
    }

    await expect(verifyHistoryDistributionReceipt(
      client,
      savedEntry,
      payer,
      'Arc Mainnet',
    )).resolves.toMatchObject({
      payer: expect.stringMatching(/^0xa{40}$/i),
      totalRaw: '1500000',
      recipients: savedEntry.recipients,
    })

    await expect(verifyHistoryDistributionReceipt(
      client,
      { ...savedEntry, totalRaw: '2000000' },
      payer,
      'Arc Mainnet',
    )).rejects.toThrow(/do not match the saved total/i)

    const receiptWithoutDistribution = { ...receipt, logs: receipt.logs.slice(0, 2) }
    vi.mocked(client.getTransactionReceipt).mockResolvedValue(
      receiptWithoutDistribution as Awaited<ReturnType<PublicClient['getTransactionReceipt']>>,
    )
    await expect(verifyHistoryDistributionReceipt(
      client,
      savedEntry,
      payer,
      'Arc Mainnet',
    )).rejects.toThrow(/no matching ArcSplit distribution event/i)
  })

  it('retries transient RPC failures and times out stalled requests without returning partial results', async () => {
    const address = '0x5555555555555555555555555555555555555555' as Address
    const getLogs = vi.fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce([])
    const client = {
      getBlockNumber: vi.fn(async () => 10n),
      getBlock: vi.fn(async () => ({ timestamp, hash: blockHash })),
      getBytecode: vi.fn(async () => '0x6000' as Hex),
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
      getBlockNumber: vi.fn(async () => 10n),
      getBlock: vi.fn(async () => ({ timestamp, hash: blockHash })),
      getBytecode: vi.fn(async () => '0x6000' as Hex),
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
