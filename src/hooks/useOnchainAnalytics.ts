import { useCallback, useEffect, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID, getArcNetwork } from '@/utils/arcsplit'
import {
  readOnchainScanCache,
  scanOnchainDistributions,
} from '@/utils/onchainAnalytics'
import type {
  OnchainCacheReadResult,
  OnchainDistributionRecord,
  OnchainScanOptions,
  OnchainScanProgress,
  OnchainScanResult,
} from '@/utils/onchainAnalytics'
import type { Address } from 'viem'

export interface OnchainContractScanState {
  contractAddress: Address
  status: 'pending' | 'scanning' | 'verified' | 'failed'
  progress?: OnchainScanProgress
  error?: string
}

export type OnchainAnalyticsState =
  | { status: 'idle'; contextKey: string }
  | {
    status: 'loading'
    contextKey: string
    progress: OnchainScanProgress
    contracts: OnchainContractScanState[]
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
    status: 'partial'
    contextKey: string
    records: OnchainDistributionRecord[]
    deploymentBlock: bigint
    deploymentTimestamp?: number
    scannedThroughBlock: bigint
    scannedThroughHash?: `0x${string}`
    warning: string
    progress: OnchainScanProgress
    contracts: OnchainContractScanState[]
    isScanning: boolean
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
  warnOnMissingContracts = true,
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
  if (warnOnMissingContracts && snapshots.length < contractAddresses.length) {
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
        coverages[0]!.deploymentBlock,
      ),
      ...(deploymentTimestamps.length
        ? { deploymentTimestamp: Math.min(...deploymentTimestamps) }
        : {}),
      scannedThroughBlock: coverages.reduce(
        (minimum, coverage) => coverage.scannedThroughBlock < minimum ? coverage.scannedThroughBlock : minimum,
        coverages[0]!.scannedThroughBlock,
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
    : progresses.some((progress) => progress.phase === 'revalidating')
      ? 'revalidating'
      : progresses.some((progress) => progress.phase === 'scanning')
        ? 'scanning'
        : 'verifying'
  const phaseProgress = progresses.filter((progress) => progress.phase === phase)
  const fromBlocks = phaseProgress.flatMap((progress) =>
    progress.fromBlock === undefined ? [] : [progress.fromBlock],
  )
  const toBlocks = phaseProgress.flatMap((progress) =>
    progress.toBlock === undefined ? [] : [progress.toBlock],
  )
  return {
    phase,
    ...(fromBlocks.length ? { fromBlock: fromBlocks.reduce((min, value) => value < min ? value : min) } : {}),
    ...(toBlocks.length ? { toBlock: toBlocks.reduce((max, value) => value > max ? value : max) } : {}),
    blocksScanned: phaseProgress.reduce((sum, progress) => sum + progress.blocksScanned, 0n),
    totalBlocks: phaseProgress.reduce((sum, progress) => sum + progress.totalBlocks, 0n),
    receiptsChecked: phaseProgress.reduce((sum, progress) => sum + progress.receiptsChecked, 0),
    totalReceipts: phaseProgress.reduce((sum, progress) => sum + progress.totalReceipts, 0),
  }
}

async function scanContractSet(
  client: Parameters<typeof scanOnchainDistributions>[0],
  options: Omit<OnchainScanOptions, 'contractAddress' | 'onProgress'> & {
    contractAddresses: readonly Address[]
    onProgress?: OnchainScanOptions['onProgress']
    onContractProgress?: (index: number, progress: OnchainScanProgress) => void
    onContractResult?: (index: number, result: OnchainScanResult) => void
    onContractFailure?: (index: number, message: string) => void
  },
): Promise<OnchainCacheReadResult> {
  if (options.contractAddresses.length === 0) {
    throw new Error('No ArcSplit analytics contract addresses are configured for this network.')
  }
  const results = Array.from(
    { length: options.contractAddresses.length },
    (): OnchainScanResult | undefined => undefined,
  )
  const failures: Array<{ contractAddress: Address; message: string }> = []
  const progressByIndex = new Map<number, OnchainScanProgress>()
  const settledIndexes = new Set<number>()
  let nextIndex = 0
  const emitAggregateProgress = () => {
    const activeProgress = options.contractAddresses.flatMap((_, index) =>
      settledIndexes.has(index)
        ? []
        : [progressByIndex.get(index) ?? initialProgress],
    )
    if (activeProgress.length) options.onProgress?.(aggregateProgress(activeProgress))
  }
  const worker = async (): Promise<void> => {
    while (nextIndex < options.contractAddresses.length) {
      const index = nextIndex
      nextIndex += 1
      const contractAddress = options.contractAddresses[index]
      if (!contractAddress) throw new Error('An ArcSplit analytics contract address is missing.')
      try {
        const result = await scanOnchainDistributions(client, {
          chainId: options.chainId,
          networkName: options.networkName,
          contractAddress,
          payer: options.payer,
          forceRescan: options.forceRescan,
          onProgress: (progress) => {
            progressByIndex.set(index, progress)
            options.onContractProgress?.(index, progress)
            emitAggregateProgress()
          },
        })
        results[index] = result
        settledIndexes.add(index)
        options.onContractResult?.(index, result)
        emitAggregateProgress()
      } catch (error) {
        settledIndexes.add(index)
        const message = error instanceof Error ? error.message : String(error)
        failures.push({
          contractAddress,
          message,
        })
        options.onContractFailure?.(index, message)
        emitAggregateProgress()
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(2, options.contractAddresses.length) },
      () => worker(),
    ),
  )
  if (failures.length === options.contractAddresses.length) {
    throw new Error(failures.map(({ message }) => message).join(' | '))
  }
  const failureWarning = failures.length
    ? `Missing successful analytics data for ${failures.length} of ${options.contractAddresses.length} ArcSplit contract${failures.length === 1 ? '' : 's'}: ${failures.map(({ contractAddress, message }) =>
      `${contractAddress}: ${message}`,
    ).join('; ')}`
    : undefined
  return combineSnapshots(
    results,
    options.contractAddresses,
    [
      ...results.map((result) => result?.cacheWarning),
      failureWarning,
    ],
    false,
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
  const [request, setRequest] = useState({ id: 0, contextKey: '', forceRescan: false })
  const [state, setState] = useState<OnchainAnalyticsState>({
    status: 'idle',
    contextKey: '',
  })

  useEffect(() => {
    let active = true
    if (!accountAddress || !network) {
      setState({ status: 'idle', contextKey })
      return () => { active = false }
    }

    const forceRescan = request.contextKey === contextKey && request.forceRescan
    const cachedReads = analyticsContractAddresses.map((contractAddress) => readOnchainScanCache({
      chainId: network.chainId,
      networkName: network.name,
      contractAddress,
      payer: accountAddress,
    }))
    const cached = combineSnapshots(
      cachedReads.map((cachedRead) => cachedRead.snapshot),
      analyticsContractAddresses,
      cachedReads.map((cachedRead) => cachedRead.warning),
    )
    const staleSnapshot = cached.snapshot
    const staleCacheWarning = cached.warning
    const contractStates: OnchainContractScanState[] = analyticsContractAddresses.map((contractAddress) => ({
      contractAddress,
      status: 'pending',
    }))
    const verifiedResults = Array.from(
      { length: analyticsContractAddresses.length },
      (): OnchainScanResult | undefined => undefined,
    )
    let currentProgress = { ...initialProgress }
    const publishScanProgress = () => {
      const contracts = contractStates.map((contract) => ({ ...contract }))
      const combinedVerified = combineSnapshots(
        verifiedResults,
        analyticsContractAddresses,
        [],
        false,
      ).snapshot
      const isScanning = contracts.some((contract) =>
        contract.status === 'pending' || contract.status === 'scanning',
      )

      if (combinedVerified && isScanning) {
        const verifiedCount = contracts.filter((contract) => contract.status === 'verified').length
        const pending = contracts
          .filter((contract) => contract.status === 'pending' || contract.status === 'scanning')
          .map((contract) => contract.contractAddress)
        const failed = contracts
          .filter((contract) => contract.status === 'failed')
          .map((contract) => `${contract.contractAddress}: ${contract.error ?? 'scan failed'}`)
        setState({
          status: 'partial',
          contextKey,
          records: combinedVerified.records,
          deploymentBlock: combinedVerified.coverage.deploymentBlock,
          ...(combinedVerified.coverage.deploymentTimestamp === undefined
            ? {}
            : { deploymentTimestamp: combinedVerified.coverage.deploymentTimestamp }),
          scannedThroughBlock: combinedVerified.coverage.scannedThroughBlock,
          ...(combinedVerified.coverage.scannedThroughHash
            ? { scannedThroughHash: combinedVerified.coverage.scannedThroughHash }
            : {}),
          warning: [
            `Verified results from ${verifiedCount} of ${analyticsContractAddresses.length} configured contracts.`,
            ...(pending.length ? [`Still scanning: ${pending.join(', ')}.`] : []),
            ...(failed.length ? [`Failed: ${failed.join('; ')}.`] : []),
          ].join(' '),
          progress: currentProgress,
          contracts,
          isScanning: true,
        })
        return
      }

      setState({
        status: 'loading',
        contextKey,
        progress: currentProgress,
        contracts,
        ...(staleSnapshot ? { snapshot: staleSnapshot } : {}),
        ...(staleCacheWarning ? { cacheWarning: staleCacheWarning } : {}),
      })
    }
    setState({
      status: 'loading',
      contextKey,
      progress: { ...initialProgress },
      contracts: contractStates.map((contract) => ({ ...contract })),
      ...(staleSnapshot ? { snapshot: staleSnapshot } : {}),
      ...(staleCacheWarning ? { cacheWarning: staleCacheWarning } : {}),
    })
    if (!publicClient || publicClient.chain?.id !== chainId) {
      setState({
        status: 'error',
        contextKey,
        message: `No read-only RPC client is available for ${network.name}.`,
        ...(staleSnapshot ? { snapshot: staleSnapshot } : {}),
        ...(staleCacheWarning ? { cacheWarning: staleCacheWarning } : {}),
      })
      return () => { active = false }
    }

    void scanContractSet(publicClient, {
      chainId,
      networkName: network.name,
      contractAddresses: analyticsContractAddresses,
      payer: accountAddress,
      forceRescan,
      onProgress: (progress) => {
        if (!active) return
        currentProgress = progress
        publishScanProgress()
      },
      onContractProgress: (index, progress) => {
        if (!active) return
        const current = contractStates[index]
        if (!current) return
        contractStates[index] = {
          ...current,
          status: 'scanning',
          progress,
        }
        publishScanProgress()
      },
      onContractResult: (index, result) => {
        if (!active) return
        const current = contractStates[index]
        if (!current) return
        verifiedResults[index] = result
        contractStates[index] = { ...current, status: 'verified' }
        publishScanProgress()
      },
      onContractFailure: (index, message) => {
        if (!active) return
        const current = contractStates[index]
        if (!current) return
        contractStates[index] = { ...current, status: 'failed', error: message }
        publishScanProgress()
      },
    }).then((combined) => {
      if (!active) return
      if (!combined.snapshot) {
        throw new Error(combined.warning ?? 'ArcSplit analytics scans returned no verified snapshot.')
      }
      const result = combined.snapshot
      if (combined.warning?.includes('Missing successful analytics data')) {
        setState({
          status: 'partial',
          contextKey,
          records: result.records,
          deploymentBlock: result.coverage.deploymentBlock,
          ...(result.coverage.deploymentTimestamp === undefined
            ? {}
            : { deploymentTimestamp: result.coverage.deploymentTimestamp }),
          scannedThroughBlock: result.coverage.scannedThroughBlock,
          ...(result.coverage.scannedThroughHash ? { scannedThroughHash: result.coverage.scannedThroughHash } : {}),
          warning: combined.warning,
          progress: currentProgress,
          contracts: contractStates.map((contract) => ({ ...contract })),
          isScanning: false,
        })
        return
      }
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
        ...(staleSnapshot ? { snapshot: staleSnapshot } : {}),
        ...(staleCacheWarning ? { cacheWarning: staleCacheWarning } : {}),
      })
    })

    return () => { active = false }
  }, [
    accountAddress,
    analyticsContractAddresses,
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
  const currentState: OnchainAnalyticsState = state.contextKey === contextKey
    ? state
    : {
      status: 'loading',
      contextKey,
      progress: { ...initialProgress },
      contracts: analyticsContractAddresses.map((contractAddress) => ({
        contractAddress,
        status: 'pending',
      })),
    }

  return { state: currentState, retry: refresh, refresh, rescan, network }
}
