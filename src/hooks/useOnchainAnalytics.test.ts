import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useOnchainAnalytics } from './useOnchainAnalytics'

const mocks = vi.hoisted(() => ({
  scan: vi.fn(),
  mainnetNetwork: {
    chainId: 5042,
    name: 'Arc Mainnet',
    contractAddress: '0xB7Ee9d819AA626F3ABA56ab3948bC56fa62f0E7E',
    analyticsContractAddresses: ['0xB7Ee9d819AA626F3ABA56ab3948bC56fa62f0E7E'],
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
}))

const mainnetWallet = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`
const secondWallet = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as `0x${string}`

beforeEach(() => {
  mocks.mainnetNetwork.analyticsContractAddresses = [mocks.mainnetNetwork.contractAddress]
  mocks.scan.mockReset()
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

  it('never reports a partial multi-contract scan as ready', async () => {
    const nextContract = '0x5555555555555555555555555555555555555555'
    mocks.mainnetNetwork.analyticsContractAddresses = [
      mocks.mainnetNetwork.contractAddress,
      nextContract,
    ]
    mocks.scan.mockImplementation(async (_client, options) => {
      if (options.contractAddress === nextContract) throw new Error('new contract RPC unavailable')
      return {
        records: [],
        coverage: { deploymentBlock: 1n, scannedThroughBlock: 20n },
      }
    })

    const hook = renderHook(() => useOnchainAnalytics(mainnetWallet, 5042))

    await waitFor(() => expect(hook.result.current.state.status).toBe('error'))
    expect(hook.result.current.state.status).not.toBe('ready')
    if (hook.result.current.state.status === 'error') {
      expect(hook.result.current.state.message).toMatch(/new contract RPC unavailable/)
      expect(hook.result.current.state.snapshot).toBeUndefined()
    }
  })

  it('does not expose persisted records before the current scan verifies them', async () => {
    mocks.scan.mockReturnValue(new Promise(() => {}))
    const hook = renderHook(() => useOnchainAnalytics(mainnetWallet, 5042))

    await waitFor(() => expect(mocks.scan).toHaveBeenCalled())
    expect(mocks.scan).toHaveBeenLastCalledWith(
      mocks.clients.mainnet,
      expect.objectContaining({ payer: mainnetWallet, forceRescan: false }),
    )
    expect(hook.result.current.state.status).toBe('loading')
    if (hook.result.current.state.status === 'loading') {
      expect(hook.result.current.state.snapshot).toBeUndefined()
    }

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
