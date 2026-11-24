import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useOnchainAnalytics } from './useOnchainAnalytics'

const mocks = vi.hoisted(() => ({
  scan: vi.fn(),
  readCache: vi.fn(),
  mainnetNetwork: {
    chainId: 5042,
    name: 'Arc Mainnet',
    contractAddress: '0xF13199D9bbf965eE10f41b531Ee4aa660bB54738',
    analyticsContractAddresses: ['0xF13199D9bbf965eE10f41b531Ee4aa660bB54738'],
  },
  testnetNetwork: {
    chainId: 5042002,
    name: 'Arc Testnet',
    contractAddress: '0x0c4DC391c39641B5DEa9304454B99B37c9FFFb35',
    analyticsContractAddresses: ['0x0c4DC391c39641B5DEa9304454B99B37c9FFFb35'],
  },
  clients: {
    mainnet: { chain: { id: 5042 } },
    testnet: { chain: { id: 5042002 } },
  },
}))

vi.mock('wagmi', () => ({
  usePublicClient: (parameters?: { chainId?: number }) =>
    parameters?.chainId === 5042
      ? mocks.clients.mainnet
      : parameters?.chainId === 5042002
        ? mocks.clients.testnet
        : undefined,
}))

vi.mock('@/utils/arcsplit', () => ({
  ARC_MAINNET_CHAIN_ID: 5042,
  ARC_TESTNET_CHAIN_ID: 5042002,
  getArcNetwork: (chainId: number) => chainId === 5042
    ? mocks.mainnetNetwork
    : chainId === 5042002
      ? mocks.testnetNetwork
      : undefined,
}))

vi.mock('@/utils/onchainAnalytics', () => ({
  scanOnchainDistributions: mocks.scan,
  readOnchainScanCache: mocks.readCache,
}))

const mainnetWallet = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`
const secondWallet = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as `0x${string}`
const legacyMainnetContract = '0xB7Ee9d819AA626F3ABA56ab3948bC56fa62f0E7E'

beforeEach(() => {
  mocks.mainnetNetwork.analyticsContractAddresses = [mocks.mainnetNetwork.contractAddress]
  mocks.scan.mockReset()
  mocks.readCache.mockReset()
  mocks.readCache.mockReturnValue({})
  mocks.scan.mockImplementation(async (_client, options) => ({
    records: [{
      id: `${options.chainId}:${options.payer}`,
      chainId: options.chainId,
      contractAddress: options.contractAddress,
      networkName: options.networkName,
      payer: options.payer,
      txHash: `0x${'a'.repeat(64)}`,
      blockNumber: 10n,
      blockHash: `0x${'b'.repeat(64)}`,
      logIndex: 0,
      createdAt: 1_760_000_000_000,
      totalRaw: '1000000',
      recipients: [],
      status: 'success',
      verificationStatus: 'receipt-verified',
    }],
    coverage: { deploymentBlock: 1n, scannedThroughBlock: 20n },
  }))
})

describe('useOnchainAnalytics', () => {
  it('does not scan while disconnected or on an unsupported network', async () => {
    const disconnected = renderHook(() => useOnchainAnalytics(undefined, undefined))
    await waitFor(() => expect(disconnected.result.current.state.status).toBe('idle'))
    disconnected.unmount()

    const unsupported = renderHook(() => useOnchainAnalytics(mainnetWallet, 1))
    await waitFor(() => expect(unsupported.result.current.state.status).toBe('idle'))
    expect(mocks.scan).not.toHaveBeenCalled()
  })

  it('does not read or scan the retired Mainnet contract cache', async () => {
    mocks.readCache.mockImplementation((options) => (
      options.contractAddress === legacyMainnetContract
        ? { snapshot: { records: [{ contractAddress: legacyMainnetContract }] } }
        : {}
    ))

    const hook = renderHook(() => useOnchainAnalytics(mainnetWallet, 5042))

    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'))

    const cachedAddresses = mocks.readCache.mock.calls.map(([options]) => options.contractAddress)
    const scannedAddresses = mocks.scan.mock.calls.map(([, options]) => options.contractAddress)
    expect(cachedAddresses).toEqual([mocks.mainnetNetwork.contractAddress])
    expect(mocks.scan).toHaveBeenCalledTimes(1)
    expect(scannedAddresses).toEqual([mocks.mainnetNetwork.contractAddress])
    if (hook.result.current.state.status === 'ready') {
      expect(hook.result.current.state.records.map((record) => record.contractAddress)).toEqual([
        mocks.mainnetNetwork.contractAddress,
      ])
    }
  })

  it('scans and combines all configured contract histories before reporting ready', async () => {
    const nextContract = '0x5555555555555555555555555555555555555555'
    mocks.mainnetNetwork.analyticsContractAddresses = [
      mocks.mainnetNetwork.contractAddress,
      nextContract,
    ]
    mocks.scan.mockImplementation(async (_client, options) => ({
      records: [{
        id: `${options.chainId}:${options.contractAddress}`,
        chainId: options.chainId,
        contractAddress: options.contractAddress,
        networkName: options.networkName,
        payer: options.payer,
        txHash: `0x${options.contractAddress.slice(2).padStart(64, '0')}`,
        blockNumber: 10n,
        blockHash: `0x${'b'.repeat(64)}`,
        logIndex: 0,
        createdAt: 1_760_000_000_000,
        totalRaw: '1000000',
        recipients: [],
        status: 'success',
        verificationStatus: 'receipt-verified',
      }],
      coverage: {
        deploymentBlock: options.contractAddress === nextContract ? 8n : 1n,
        deploymentTimestamp: options.contractAddress === nextContract
          ? Date.UTC(2026, 1, 1)
          : Date.UTC(2025, 5, 1),
        scannedThroughBlock: options.contractAddress === nextContract ? 18n : 20n,
      },
    }))

    const hook = renderHook(() => useOnchainAnalytics(mainnetWallet, 5042))

    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'))
    expect(mocks.scan).toHaveBeenCalledTimes(2)
    expect(mocks.scan.mock.calls.map((call) => call[1].contractAddress)).toEqual([
      mocks.mainnetNetwork.contractAddress,
      nextContract,
    ])
    if (hook.result.current.state.status === 'ready') {
      expect(hook.result.current.state.records.map((record) => record.contractAddress)).toEqual([
        mocks.mainnetNetwork.contractAddress,
        nextContract,
      ])
      expect(hook.result.current.state.deploymentBlock).toBe(1n)
      expect(hook.result.current.state.deploymentTimestamp).toBe(Date.UTC(2025, 5, 1))
      expect(hook.result.current.state.scannedThroughBlock).toBe(18n)
    }
  })

  it('publishes the first verified contract while the other contract is still scanning', async () => {
    const firstContract = mocks.mainnetNetwork.contractAddress
    const nextContract = '0x5555555555555555555555555555555555555555'
    mocks.mainnetNetwork.analyticsContractAddresses = [firstContract, nextContract]
    let releaseSecondScan: ((result: ReturnType<typeof makeScanResult>) => void) | undefined

    function makeScanResult(contractAddress: string) {
      return {
        records: [{
          id: `5042:${contractAddress}`,
          chainId: 5042,
          contractAddress,
          networkName: 'Arc Mainnet',
          payer: mainnetWallet,
          txHash: `0x${contractAddress.slice(2).padStart(64, '0')}`,
          blockNumber: 10n,
          blockHash: `0x${'b'.repeat(64)}`,
          logIndex: 0,
          createdAt: 1_760_000_000_000,
          totalRaw: '1000000',
          recipients: [],
          status: 'success',
          verificationStatus: 'receipt-verified',
        }],
        coverage: { deploymentBlock: 1n, scannedThroughBlock: 20n },
      }
    }

    mocks.scan.mockImplementation((_client, options) => {
      if (options.contractAddress === nextContract) {
        return new Promise((resolve) => { releaseSecondScan = resolve })
      }
      return Promise.resolve(makeScanResult(firstContract))
    })

    const hook = renderHook(() => useOnchainAnalytics(mainnetWallet, 5042))

    await waitFor(() => expect(hook.result.current.state.status).toBe('partial'))
    expect(mocks.scan).toHaveBeenCalledTimes(2)
    if (hook.result.current.state.status === 'partial') {
      expect(hook.result.current.state.isScanning).toBe(true)
      expect(hook.result.current.state.records[0]?.contractAddress).toBe(firstContract)
      expect(hook.result.current.state.contracts.map(({ status }) => status)).toEqual([
        'verified',
        'pending',
      ])
      expect(hook.result.current.state.warning).toContain(nextContract)
    }

    if (!releaseSecondScan) throw new Error('Second contract scan did not start.')
    await act(async () => { releaseSecondScan?.(makeScanResult(nextContract)) })
    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'))
    if (hook.result.current.state.status === 'ready') {
      expect(hook.result.current.state.records).toHaveLength(2)
    }
  })

  it('keeps revalidation distinct when aggregating concurrent contract phases', async () => {
    const firstContract = mocks.mainnetNetwork.contractAddress
    const nextContract = '0x5555555555555555555555555555555555555555'
    mocks.mainnetNetwork.analyticsContractAddresses = [firstContract, nextContract]
    mocks.scan.mockImplementation((_client, options) => {
      options.onProgress?.(options.contractAddress === firstContract
        ? {
          phase: 'revalidating',
          blocksScanned: 0n,
          totalBlocks: 0n,
          receiptsChecked: 1,
          totalReceipts: 5,
        }
        : {
          phase: 'scanning',
          fromBlock: 100n,
          toBlock: 199n,
          blocksScanned: 22n,
          totalBlocks: 100n,
          receiptsChecked: 0,
          totalReceipts: 0,
        })
      return new Promise(() => {})
    })

    const hook = renderHook(() => useOnchainAnalytics(mainnetWallet, 5042))

    await waitFor(() => {
      expect(hook.result.current.state.status).toBe('loading')
      if (hook.result.current.state.status === 'loading') {
        expect(hook.result.current.state.progress.phase).toBe('revalidating')
      }
    })
    if (hook.result.current.state.status === 'loading') {
      expect(hook.result.current.state.progress).toMatchObject({
        phase: 'revalidating',
        receiptsChecked: 1,
        totalReceipts: 5,
        blocksScanned: 0n,
        totalBlocks: 0n,
      })
      expect(hook.result.current.state.contracts.map((contract) => contract.progress?.phase)).toEqual([
        'revalidating',
        'scanning',
      ])
    }
    hook.unmount()
  })

  it('deduplicates the same verified event returned by both contract scans', async () => {
    const nextContract = '0x5555555555555555555555555555555555555555'
    const sharedHash = `0x${'c'.repeat(64)}`
    mocks.mainnetNetwork.analyticsContractAddresses = [
      mocks.mainnetNetwork.contractAddress,
      nextContract,
    ]
    mocks.scan.mockImplementation(async (_client, options) => ({
      records: [{
        id: `${options.chainId}:${sharedHash}:4`,
        chainId: options.chainId,
        contractAddress: options.contractAddress,
        networkName: options.networkName,
        payer: options.payer,
        txHash: sharedHash,
        blockNumber: 10n,
        blockHash: `0x${'b'.repeat(64)}`,
        logIndex: 4,
        createdAt: 1_760_000_000_000,
        totalRaw: '1000000',
        recipients: [],
        status: 'success',
        verificationStatus: 'receipt-verified',
      }],
      coverage: { deploymentBlock: 1n, scannedThroughBlock: 20n },
    }))

    const hook = renderHook(() => useOnchainAnalytics(mainnetWallet, 5042))

    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'))
    if (hook.result.current.state.status === 'ready') {
      expect(hook.result.current.state.records).toHaveLength(1)
      expect(hook.result.current.state.records[0]?.txHash).toBe(sharedHash)
    }
  })

  it('reports partial multi-contract success and preserves the failed contract warning', async () => {
    const nextContract = '0x5555555555555555555555555555555555555555'
    mocks.mainnetNetwork.analyticsContractAddresses = [
      mocks.mainnetNetwork.contractAddress,
      nextContract,
    ]
    mocks.scan.mockImplementation(async (_client, options) => {
      if (options.contractAddress === nextContract) throw new Error('new contract RPC unavailable')
      return {
        records: [{
          id: `${options.chainId}:${options.contractAddress}:0`,
          chainId: options.chainId,
          contractAddress: options.contractAddress,
          networkName: options.networkName,
          payer: options.payer,
          txHash: `0x${'e'.repeat(64)}`,
          blockNumber: 10n,
          blockHash: `0x${'f'.repeat(64)}`,
          logIndex: 0,
          createdAt: 1_760_000_000_000,
          totalRaw: '1000000',
          recipients: [],
          status: 'success',
          verificationStatus: 'receipt-verified',
        }],
        coverage: { deploymentBlock: 1n, scannedThroughBlock: 20n },
      }
    })

    const hook = renderHook(() => useOnchainAnalytics(mainnetWallet, 5042))

    await waitFor(() => expect(hook.result.current.state.status).toBe('partial'))
    if (hook.result.current.state.status === 'partial') {
      expect(hook.result.current.state.records).toHaveLength(1)
      expect(hook.result.current.state.warning).toMatch(/Missing successful analytics data/)
      expect(hook.result.current.state.warning).toMatch(/new contract RPC unavailable/)
      expect(hook.result.current.state.contracts.map((contract) => contract.status)).toEqual([
        'verified',
        'failed',
      ])
      expect(hook.result.current.state.contracts[1]?.error).toMatch(/new contract RPC unavailable/)
    }
  })

  it('exposes a persisted snapshot immediately while a background scan continues', async () => {
    const cachedRecord = {
      id: '5042:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:0',
      chainId: 5042,
      contractAddress: mocks.mainnetNetwork.contractAddress,
      networkName: 'Arc Mainnet',
      payer: mainnetWallet,
      txHash: `0x${'a'.repeat(64)}`,
      blockNumber: 10n,
      blockHash: `0x${'b'.repeat(64)}`,
      logIndex: 0,
      createdAt: 1_760_000_000_000,
      totalRaw: '1000000',
      recipients: [],
      status: 'success',
      verificationStatus: 'unverified',
    }
    mocks.readCache.mockReturnValue({
      snapshot: {
        records: [cachedRecord],
        coverage: {
          deploymentBlock: 1n,
          deploymentTimestamp: 1_760_000_000_000,
          scannedThroughBlock: 20n,
          scannedThroughHash: `0x${'b'.repeat(64)}`,
        },
      },
    })
    mocks.scan.mockImplementation(() => new Promise(() => {}))

    const hook = renderHook(() => useOnchainAnalytics(mainnetWallet, 5042))

    await waitFor(() => expect(hook.result.current.state.status).toBe('loading'))
    await waitFor(() => expect(hook.result.current.state.status).toBe('loading'))
    if (hook.result.current.state.status === 'loading') {
      expect(hook.result.current.state.snapshot?.records).toHaveLength(1)
      expect(hook.result.current.state.snapshot?.records[0]?.txHash).toBe(cachedRecord.txHash)
    }
  })

  it('preserves a cached snapshot when a background refresh fails transiently', async () => {
    const cachedRecord = {
      id: '5042:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:0',
      chainId: 5042,
      contractAddress: mocks.mainnetNetwork.contractAddress,
      networkName: 'Arc Mainnet',
      payer: mainnetWallet,
      txHash: `0x${'c'.repeat(64)}`,
      blockNumber: 10n,
      blockHash: `0x${'d'.repeat(64)}`,
      logIndex: 0,
      createdAt: 1_760_000_000_000,
      totalRaw: '1000000',
      recipients: [],
      status: 'success',
      verificationStatus: 'unverified',
    }
    mocks.readCache.mockReturnValue({
      snapshot: {
        records: [cachedRecord],
        coverage: {
          deploymentBlock: 1n,
          scannedThroughBlock: 20n,
          scannedThroughHash: `0x${'d'.repeat(64)}`,
        },
      },
    })
    mocks.scan.mockRejectedValue(new Error('fetch failed'))

    const hook = renderHook(() => useOnchainAnalytics(mainnetWallet, 5042))

    await waitFor(() => expect(hook.result.current.state.status).toBe('error'))
    if (hook.result.current.state.status === 'error') {
      expect(hook.result.current.state.message).toMatch(/fetch failed/)
      expect(hook.result.current.state.snapshot?.records).toHaveLength(1)
      expect(hook.result.current.state.snapshot?.records[0]?.verificationStatus).toBe('unverified')
      expect('records' in hook.result.current.state).toBe(false)
    }
  })

  it('replaces a stale cached preview with freshly verified refresh results', async () => {
    const cachedRecord = {
      id: '5042:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:0',
      chainId: 5042,
      contractAddress: mocks.mainnetNetwork.contractAddress,
      networkName: 'Arc Mainnet',
      payer: mainnetWallet,
      txHash: `0x${'c'.repeat(64)}`,
      blockNumber: 10n,
      blockHash: `0x${'d'.repeat(64)}`,
      logIndex: 0,
      createdAt: 1_760_000_000_000,
      totalRaw: '1000000',
      recipients: [],
      status: 'success',
      verificationStatus: 'unverified',
    }
    mocks.readCache.mockReturnValue({
      snapshot: {
        records: [cachedRecord],
        coverage: {
          deploymentBlock: 1n,
          scannedThroughBlock: 20n,
          scannedThroughHash: `0x${'d'.repeat(64)}`,
        },
      },
    })
    mocks.scan.mockResolvedValue({
      records: [{
        ...cachedRecord,
        verificationStatus: 'receipt-verified',
        txHash: `0x${'e'.repeat(64)}`,
        totalRaw: '2000000',
      }],
      coverage: { deploymentBlock: 1n, scannedThroughBlock: 21n },
    })

    const hook = renderHook(() => useOnchainAnalytics(mainnetWallet, 5042))

    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'))
    if (hook.result.current.state.status === 'ready') {
      expect(hook.result.current.state.records).toHaveLength(1)
      expect(hook.result.current.state.records[0]?.verificationStatus).toBe('receipt-verified')
      expect(hook.result.current.state.records[0]?.totalRaw).toBe('2000000')
      expect(hook.result.current.state.records[0]?.txHash).not.toBe(cachedRecord.txHash)
      expect(hook.result.current.state.cacheWarning).toBeUndefined()
    }
  })

  it('does not expose persisted records before the current scan verifies them', async () => {
    const cachedRecord = {
      id: '5042:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:0',
      chainId: 5042,
      contractAddress: mocks.mainnetNetwork.contractAddress,
      networkName: 'Arc Mainnet',
      payer: mainnetWallet,
      txHash: `0x${'a'.repeat(64)}`,
      blockNumber: 10n,
      blockHash: `0x${'b'.repeat(64)}`,
      logIndex: 0,
      createdAt: 1_760_000_000_000,
      totalRaw: '1000000',
      recipients: [{ address: mainnetWallet, amountRaw: '1000000' }],
      status: 'success',
      verificationStatus: 'unverified',
    }
    mocks.readCache.mockReturnValue({
      snapshot: {
        records: [cachedRecord],
        coverage: {
          deploymentBlock: 1n,
          scannedThroughBlock: 20n,
          scannedThroughHash: `0x${'b'.repeat(64)}`,
        },
      },
    })
    mocks.scan.mockReturnValue(new Promise(() => {}))
    const hook = renderHook(() => useOnchainAnalytics(mainnetWallet, 5042))

    await waitFor(() => expect(mocks.scan).toHaveBeenCalled())
    expect(mocks.scan).toHaveBeenLastCalledWith(mocks.clients.mainnet, expect.objectContaining({
      payer: mainnetWallet,
      forceRescan: false,
    }))
    expect(hook.result.current.state.status).toBe('loading')
    if (hook.result.current.state.status === 'loading') {
      expect(hook.result.current.state.snapshot?.records[0]?.verificationStatus).toBe('unverified')
    }
    expect('records' in hook.result.current.state).toBe(false)

    act(() => hook.result.current.rescan())
    await waitFor(() => expect(mocks.scan).toHaveBeenLastCalledWith(
      mocks.clients.mainnet,
      expect.objectContaining({ payer: mainnetWallet, forceRescan: true }),
    ))
  })

  it('resets immediately and refetches against the newly selected wallet and Arc network', async () => {
    let releaseTestnetScan: (() => void) | undefined
    mocks.scan.mockImplementation(async (_client, options) => {
      if (options.payer === secondWallet) {
        await new Promise<void>((resolve) => { releaseTestnetScan = resolve })
      }
      return {
        records: [{
          id: `${options.chainId}:${options.payer}`,
          chainId: options.chainId,
          contractAddress: options.contractAddress,
          networkName: options.networkName,
          payer: options.payer,
          txHash: `0x${'a'.repeat(64)}`,
          blockNumber: 10n,
          blockHash: `0x${'b'.repeat(64)}`,
          logIndex: 0,
          createdAt: 1_760_000_000_000,
          totalRaw: '1000000',
          recipients: [],
          status: 'success',
          verificationStatus: 'receipt-verified',
        }],
        coverage: { deploymentBlock: 1n, scannedThroughBlock: 20n },
      }
    })

    const hook = renderHook(
      ({ address, chainId }: { address: `0x${string}`; chainId: number }) =>
        useOnchainAnalytics(address, chainId),
      { initialProps: { address: mainnetWallet, chainId: 5042 } },
    )
    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'))
    expect(mocks.scan).toHaveBeenLastCalledWith(
      mocks.clients.mainnet,
      expect.objectContaining({ payer: mainnetWallet, chainId: 5042 }),
    )

    hook.rerender({ address: secondWallet, chainId: 5042002 })
    expect(hook.result.current.state.status).toBe('loading')
    expect(mocks.scan).toHaveBeenLastCalledWith(
      mocks.clients.testnet,
      expect.objectContaining({ payer: secondWallet, chainId: 5042002 }),
    )

    await act(async () => { releaseTestnetScan?.() })
    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'))
    if (hook.result.current.state.status === 'ready') {
      expect(hook.result.current.state.records[0]?.payer).toBe(secondWallet)
    }
  })

  it('surfaces scan failures and allows an explicit retry', async () => {
    mocks.scan
      .mockRejectedValueOnce(new Error('historical RPC unavailable'))
      .mockImplementationOnce(async () => ({
        records: [],
        coverage: { deploymentBlock: 1n, scannedThroughBlock: 20n },
      }))
    const hook = renderHook(() => useOnchainAnalytics(mainnetWallet, 5042))

    await waitFor(() => expect(hook.result.current.state.status).toBe('error'))
    if (hook.result.current.state.status === 'error') {
      expect(hook.result.current.state.message).toMatch(/historical RPC unavailable/)
    }
    act(() => hook.result.current.retry())
    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'))
    expect(mocks.scan).toHaveBeenCalledTimes(2)
  })
})
