import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID, getArcNetwork } from '@/utils/arcsplit'
import { readOnchainScanCache, scanOnchainDistributions } from '@/utils/onchainAnalytics'
import type {
  OnchainCacheReadResult,
  OnchainDistributionRecord,
  OnchainScanOptions,
  OnchainScanProgress,
  OnchainScanResult,
} from '@/utils/onchainAnalytics'
import type { Address } from 'viem'

export type OnchainAnalyticsState =
  | { status: 'idle'; contextKey: string }
  | {
    status: 'loading'
    contextKey: string
    progress: OnchainScanProgress
    snapshot?: OnchainScanResult
    cacheWarning?: string
  }
  | {
    status: 'ready'
    contextKey: string
    records: OnchainDistributionRecord[]
    deploymentBlock: bigint
    deploymentTimestamp?: number
    scannedThroughBlock: bigint
    scannedThroughHash?: `0x${string}`
    cacheWarning?: string
  }
  | {
    status: 'error'
    contextKey: string
    message: string
    snapshot?: OnchainScanResult
    cacheWarning?: string
  }

const initialProgress: OnchainScanProgress = {
  phase: 'discovering',
  blocksScanned: 0n,
  totalBlocks: 0n,
  receiptsChecked: 0,
  totalReceipts: 0,
}

const EMPTY_CONTRACT_ADDRESSES: readonly Address[] = []

function combineSnapshots(
  results: Array<OnchainScanResult | undefined>,
  contractAddresses: readonly Address[],
  warnings: Array<string | undefined> = [],
): OnchainCacheReadResult {
  const snapshots: Array<{ snapshot: OnchainScanResult; contractAddress: Address }> = []
  results.forEach((snapshot, index) => {
    if (!snapshot) return
    const contractAddress = contractAddresses[index]
    if (!contractAddress) throw new Error('An ArcSplit analytics snapshot has no matching contract address.')
    snapshots.push({ snapshot, contractAddress })
  })
  const warningMessages = warnings.filter((warning): warning is string => !!warning)
  if (snapshots.length === 0) {
    return warningMessages.length ? { warning: [...new Set(warningMessages)].join(' ') } : {}
  }
  if (snapshots.length < contractAddresses.length) {
    warningMessages.push(
      `Only ${snapshots.length} of ${contractAddresses.length} configured ArcSplit contract caches are available; this cached snapshot is partial.`,
    )
  }

  const coverages = snapshots.map(({ snapshot, contractAddress }) => ({
    contractAddress,
    deploymentBlock: snapshot.coverage.deploymentBlock,
    ...(snapshot.coverage.deploymentTimestamp === undefined
      ? {}
      : { deploymentTimestamp: snapshot.coverage.deploymentTimestamp }),
    scannedThroughBlock: snapshot.coverage.scannedThroughBlock,
  }))
  const deploymentTimestamps = coverages.flatMap((coverage) =>
    coverage.deploymentTimestamp === undefined ? [] : [coverage.deploymentTimestamp],
  )
  const firstCoverage = coverages[0]
  if (!firstCoverage) throw new Error('ArcSplit analytics snapshots have no coverage data.')
  const records = new Map<string, OnchainDistributionRecord>()
  for (const { snapshot } of snapshots) {
    for (const record of snapshot.records) records.set(record.id, record)
  }
  const combined: OnchainScanResult = {
    records: [...records.values()].sort((first, second) =>
      first.blockNumber < second.blockNumber
        ? -1
        : first.blockNumber > second.blockNumber
          ? 1
          : first.logIndex - second.logIndex,
    ),
    coverage: {
      deploymentBlock: coverages.reduce(
        (minimum, coverage) => coverage.deploymentBlock < minimum ? coverage.deploymentBlock : minimum,
        firstCoverage.deploymentBlock,
      ),
      ...(deploymentTimestamps.length
        ? { deploymentTimestamp: Math.min(...deploymentTimestamps) }
        : {}),
      scannedThroughBlock: coverages.reduce(
        (minimum, coverage) => coverage.scannedThroughBlock < minimum ? coverage.scannedThroughBlock : minimum,
        firstCoverage.scannedThroughBlock,
      ),
      contracts: coverages,
      expectedContractCount: contractAddresses.length,
    },
  }
  const warning = [...new Set(warningMessages)].join(' ') || undefined
  return {
    snapshot: warning ? { ...combined, cacheWarning: warning } : combined,
    ...(warning ? { warning } : {}),
  }
}

function aggregateProgress(progresses: readonly OnchainScanProgress[]): OnchainScanProgress {
  const phase = progresses.some((progress) => progress.phase === 'discovering')
    ? 'discovering'
    : progresses.some((progress) => progress.phase === 'scanning')
      ? 'scanning'
      : 'verifying'
  const fromBlocks = progresses.flatMap((progress) =>
    progress.fromBlock === undefined ? [] : [progress.fromBlock],
  )
  const toBlocks = progresses.flatMap((progress) =>
    progress.toBlock === undefined ? [] : [progress.toBlock],
  )
  return {
    phase,
    ...(fromBlocks.length ? { fromBlock: fromBlocks.reduce((min, value) => value < min ? value : min) } : {}),
    ...(toBlocks.length ? { toBlock: toBlocks.reduce((max, value) => value > max ? value : max) } : {}),
    blocksScanned: progresses.reduce((sum, progress) => sum + progress.blocksScanned, 0n),
    totalBlocks: progresses.reduce((sum, progress) => sum + progress.totalBlocks, 0n),
    receiptsChecked: progresses.reduce((sum, progress) => sum + progress.receiptsChecked, 0),
    totalReceipts: progresses.reduce((sum, progress) => sum + progress.totalReceipts, 0),
  }
}

async function scanContractSet(
  client: Parameters<typeof scanOnchainDistributions>[0],
  options: Omit<OnchainScanOptions, 'contractAddress' | 'onProgress'> & {
    contractAddresses: readonly Address[]
    onProgress?: OnchainScanOptions['onProgress']
  },
): Promise<OnchainCacheReadResult> {
  if (options.contractAddresses.length === 0) {
    throw new Error('No ArcSplit analytics contract addresses are configured for this network.')
  }
  const results = Array<OnchainScanResult | undefined>(options.contractAddresses.length).fill(undefined)
  const progressByIndex = new Map<number, OnchainScanProgress>()
  let nextIndex = 0
  let scanFailed = false
  const worker = async (): Promise<void> => {
    while (!scanFailed && nextIndex < options.contractAddresses.length) {
      const index = nextIndex
      nextIndex += 1
      const contractAddress = options.contractAddresses[index]
      if (!contractAddress) throw new Error('An ArcSplit analytics contract address is missing.')
      try {
        results[index] = await scanOnchainDistributions(client, {
          chainId: options.chainId,
          networkName: options.networkName,
          contractAddress,
          payer: options.payer,
          forceRescan: options.forceRescan,
          onProgress: (progress) => {
            if (scanFailed) return
            progressByIndex.set(index, progress)
            options.onProgress?.(aggregateProgress(
              options.contractAddresses.map((_, itemIndex) =>
                progressByIndex.get(itemIndex) ?? initialProgress,
              ),
            ))
          },
        })
      } catch (error) {
        scanFailed = true
        throw error
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(2, options.contractAddresses.length) },
      () => worker(),
    ),
  )
  return combineSnapshots(
    results,
    options.contractAddresses,
    results.map((result) => result?.cacheWarning),
  )
}

export function useOnchainAnalytics(
  accountAddress: `0x${string}` | undefined,
  chainId: number | undefined,
) {
  const network = getArcNetwork(chainId)
  const supportedChainId = chainId === ARC_MAINNET_CHAIN_ID
    ? ARC_MAINNET_CHAIN_ID
    : chainId === ARC_TESTNET_CHAIN_ID
      ? ARC_TESTNET_CHAIN_ID
      : undefined
  const publicClient = usePublicClient(supportedChainId ? { chainId: supportedChainId } : {})
  const analyticsContractAddresses = network?.analyticsContractAddresses ?? EMPTY_CONTRACT_ADDRESSES
  const contextKey = `${accountAddress?.toLowerCase() ?? 'disconnected'}:${chainId ?? 'unsupported'}:${analyticsContractAddresses.map((address) => address.toLowerCase()).join(',') || 'no-contract'}`
  const cachedRead = useMemo(
    () => {
      if (!accountAddress || chainId === undefined || !network || !analyticsContractAddresses.length) {
        return {}
      }
      const cacheReads = analyticsContractAddresses.map((contractAddress) =>
        readOnchainScanCache({
            chainId,
            networkName: network.name,
            contractAddress,
            payer: accountAddress,
        }),
      )
      return combineSnapshots(
        cacheReads.map((cacheRead) => cacheRead.snapshot),
        analyticsContractAddresses,
        cacheReads.map((cacheRead) => cacheRead.warning),
      )
    },
    [accountAddress, analyticsContractAddresses, chainId, network],
  )
  const [request, setRequest] = useState({ id: 0, contextKey: '', forceRescan: false })
  const [state, setState] = useState<OnchainAnalyticsState>({
    status: 'idle',
    contextKey: '',
  })

  useEffect(() => {
    let active = true
    if (!accountAddress || !network) {
      return () => { active = false }
    }

    const forceRescan = request.contextKey === contextKey && request.forceRescan
    const cachedSnapshot = cachedRead.snapshot
    if (!publicClient || publicClient.chain?.id !== chainId) {
      return () => { active = false }
    }

    void scanContractSet(publicClient, {
      chainId,
      networkName: network.name,
      contractAddresses: analyticsContractAddresses,
      payer: accountAddress,
      forceRescan,
      onProgress: (progress) => {
        if (active) setState({
          status: 'loading',
          contextKey,
          progress,
          ...(cachedSnapshot ? { snapshot: cachedSnapshot } : {}),
          ...(cachedRead.warning ? { cacheWarning: cachedRead.warning } : {}),
        })
      },
    }).then((combined) => {
      if (!active) return
      if (!combined.snapshot) {
        throw new Error(combined.warning ?? 'ArcSplit analytics scans returned no verified snapshot.')
      }
      const result = combined.snapshot
      setState({
        status: 'ready',
        contextKey,
        records: result.records,
        deploymentBlock: result.coverage.deploymentBlock,
        ...(result.coverage.deploymentTimestamp === undefined
          ? {}
          : { deploymentTimestamp: result.coverage.deploymentTimestamp }),
        scannedThroughBlock: result.coverage.scannedThroughBlock,
        ...(result.coverage.scannedThroughHash ? { scannedThroughHash: result.coverage.scannedThroughHash } : {}),
        ...(combined.warning || result.cacheWarning
          ? { cacheWarning: combined.warning ?? result.cacheWarning }
          : {}),
      })
    }).catch((error: unknown) => {
      if (!active) return
      setState({
        status: 'error',
        contextKey,
        message: error instanceof Error ? error.message : String(error),
        ...(cachedSnapshot ? { snapshot: cachedSnapshot } : {}),
        ...(cachedRead.warning ? { cacheWarning: cachedRead.warning } : {}),
      })
    })

    return () => { active = false }
  }, [
    accountAddress,
    analyticsContractAddresses,
    cachedRead,
    chainId,
    contextKey,
    network,
    publicClient,
    request,
  ])

  const refresh = useCallback(() => setRequest((current) => ({
    id: current.id + 1,
    contextKey,
    forceRescan: false,
  })), [contextKey])
  const rescan = useCallback(() => setRequest((current) => ({
    id: current.id + 1,
    contextKey,
    forceRescan: true,
  })), [contextKey])
  const currentState: OnchainAnalyticsState = !accountAddress || !network
    ? { status: 'idle', contextKey }
    : !publicClient || publicClient.chain?.id !== chainId
      ? {
        status: 'error',
        contextKey,
        message: `No read-only RPC client is available for ${network.name}.`,
        ...(cachedRead.snapshot ? { snapshot: cachedRead.snapshot } : {}),
        ...(cachedRead.warning ? { cacheWarning: cachedRead.warning } : {}),
      }
      : state.contextKey === contextKey
        ? state
        : {
          status: 'loading',
          contextKey,
          progress: {
            ...initialProgress,
            phase: cachedRead.snapshot ? 'scanning' : 'discovering',
          },
          ...(cachedRead.snapshot ? { snapshot: cachedRead.snapshot } : {}),
          ...(cachedRead.warning ? { cacheWarning: cachedRead.warning } : {}),
        }

  return { state: currentState, retry: refresh, refresh, rescan, network }
}
