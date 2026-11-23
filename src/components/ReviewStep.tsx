import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain, useSimulateContract } from 'wagmi'
import { erc20Abi, WaitForTransactionReceiptTimeoutError } from 'viem'
import { Loader2, ArrowLeft, ExternalLink, Check, AlertCircle, ArrowRight } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { toast } from 'sonner'
import {
  formatUsdc,
  shortAddress,
  parseContractError,
  txUrl,
  ARCSPLIT_FIXED_ABI,
  ARC_MAINNET_CHAIN_ID,
  getArcNetwork,
  isValidAddress,
  isProductionArcEnvironment,
} from '@/utils/arcsplit'
import type { Recipient } from '@/utils/arcsplit'
import { useUsdcAllowance } from '@/hooks/useUsdcAllowance'
import { useUsdcBalance } from '@/hooks/useUsdcBalance'
import { playSuccessSound } from '@/utils/successSound'
import { addHistoryEntry } from '@/utils/splitStorage'
import {
  clearPendingTransaction,
  getPendingTransaction,
  savePendingTransaction,
} from '@/utils/pendingTransaction'

interface Props {
  amountRaw: bigint
  recipients: Recipient[]
  onBack: () => void
  onReset: () => void
  onDistributionConfirmed?: () => void
}

const soundedDistributionHashes = new Set<`0x${string}`>()

type TxPhase = 'idle' | 'approving' | 'distributing'

interface DistributionSubmissionContext {
  address: `0x${string}` | undefined
  chainId: number | undefined
  contractAddress?: `0x${string}`
  totalRaw: string
  recipients: Array<{ address: string; amountRaw: string }>
}

function transactionContextKey(
  address: `0x${string}` | undefined,
  chainId: number | undefined,
  contractAddress?: `0x${string}`,
): string {
  return `${address?.toLowerCase() ?? ''}:${chainId ?? ''}:${contractAddress?.toLowerCase() ?? ''}`
}

function receiptErrorMessage(error: Error | null, action: string): string {
  if (error instanceof WaitForTransactionReceiptTimeoutError) {
    return `Timed out waiting for the ${action} receipt. The transaction outcome is unknown; check the explorer or retry the status check.`
  }
  return `Could not retrieve the ${action} receipt. The transaction outcome is unknown; check the explorer or retry the status check.`
}

function detailedErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (!error || typeof error !== 'object') return 'The operation failed for an unknown reason.'

  const candidate = error as {
    shortMessage?: unknown
    details?: unknown
    message?: unknown
    cause?: unknown
  }
  const primary = typeof candidate.shortMessage === 'string'
    ? candidate.shortMessage
    : typeof candidate.message === 'string'
      ? candidate.message
      : 'The operation failed.'
  const detail = typeof candidate.details === 'string'
    ? candidate.details
    : candidate.cause && typeof candidate.cause === 'object'
      && 'shortMessage' in candidate.cause
      && typeof candidate.cause.shortMessage === 'string'
      ? candidate.cause.shortMessage
      : undefined

  return detail && detail !== primary ? `${primary}: ${detail}` : primary
}

function transactionErrorMessage(error: unknown): string {
  const parsed = parseContractError(error)
  return parsed === 'Transaction failed. Please try again.'
    ? detailedErrorMessage(error)
    : parsed
}

export function ReviewStep({
  amountRaw,
  recipients,
  onBack,
  onReset,
  onDistributionConfirmed,
}: Props) {
  const { address: accountAddress, chainId } = useAccount()
  const network = getArcNetwork(chainId)
  const { switchChain, isPending: isSwitching } = useSwitchChain()
  const {
    raw: allowance,
    isError: allowanceReadFailed,
    error: allowanceReadError,
    isLoading: allowanceLoading,
    isFetching: allowanceFetching,
    refetch: refetchAllowance,
  } = useUsdcAllowance()
  const {
    raw: balance,
    isError: balanceReadFailed,
    error: balanceReadError,
    isLoading: balanceLoading,
    isFetching: balanceFetching,
    refetch: refetchBalance,
  } = useUsdcBalance()

  const [initialPending] = useState(() =>
    getPendingTransaction(accountAddress, chainId, network?.contractAddress),
  )
  const [txPhase, setTxPhase] = useState<TxPhase>(() =>
    initialPending?.kind === 'approval'
      ? 'approving'
      : initialPending?.kind === 'distribution'
        ? 'distributing'
        : 'idle',
  )
  const [error, setError] = useState('')
  const [approveTxHash, setApproveTxHash] = useState<`0x${string}` | undefined>(() =>
    initialPending?.kind === 'approval' ? initialPending.txHash : undefined,
  )
  const [approveTxChainId, setApproveTxChainId] = useState<number | undefined>(() =>
    initialPending?.kind === 'approval' ? chainId : undefined,
  )
  const [distributeTxHash, setDistributeTxHash] = useState<`0x${string}` | undefined>(() =>
    initialPending?.kind === 'distribution' ? initialPending.txHash : undefined,
  )
  const [distributeTxChainId, setDistributeTxChainId] = useState<number | undefined>(() =>
    initialPending?.kind === 'distribution' ? chainId : undefined,
  )
  const [isAllowanceRefreshing, setIsAllowanceRefreshing] = useState(false)
  const allowanceRefreshId = useRef(0)
  const approvalContext = useRef<{
    address: `0x${string}` | undefined
    chainId: number | undefined
    contractAddress?: `0x${string}`
  } | undefined>(initialPending?.kind === 'approval'
    ? { address: accountAddress, chainId, contractAddress: initialPending.contractAddress }
    : undefined)
  const distributionContext = useRef<DistributionSubmissionContext | undefined>(
    initialPending?.kind === 'distribution'
      ? {
          address: accountAddress,
          chainId,
          contractAddress: initialPending.contractAddress,
          totalRaw: initialPending.amountRaw,
          recipients: initialPending.recipients.map(({ address, amountRaw }) => ({
            address,
            amountRaw,
          })),
        }
      : undefined,
  )
  const submissionLock = useRef<'approval' | 'distribution' | null>(initialPending?.kind ?? null)
  const submissionGeneration = useRef(0)
  const allowanceRefreshes = useRef(new Map<`0x${string}`, number>())
  const handledApprovalHashes = useRef(new Set<`0x${string}`>())
  const handledDistributionHashes = useRef(new Set<`0x${string}`>())
  const currentContextKey = transactionContextKey(accountAddress, chainId, network?.contractAddress)
  const [approvalContextKey, setApprovalContextKey] = useState<string | undefined>(() =>
    initialPending?.kind === 'approval'
      ? transactionContextKey(accountAddress, chainId, initialPending.contractAddress)
      : undefined,
  )
  const [distributionContextKey, setDistributionContextKey] = useState<string | undefined>(() =>
    initialPending?.kind === 'distribution'
      ? transactionContextKey(accountAddress, chainId, initialPending.contractAddress)
      : undefined,
  )
  const currentContextKeyRef = useRef(currentContextKey)
  const previousContextKey = useRef(currentContextKey)
  const contextGeneration = useRef(0)

  useLayoutEffect(() => {
    currentContextKeyRef.current = currentContextKey
    contextGeneration.current += 1
    allowanceRefreshId.current += 1
    submissionGeneration.current += 1
    allowanceRefreshes.current.clear()
  }, [currentContextKey])

  useEffect(() => {
    const changed = previousContextKey.current !== currentContextKey
    previousContextKey.current = currentContextKey
    if (!changed) return

    queueMicrotask(() => {
      if (previousContextKey.current === currentContextKey) setIsAllowanceRefreshing(false)
    })
    const pending = getPendingTransaction(accountAddress, chainId, network?.contractAddress)
    const syncGeneration = contextGeneration.current
    const pendingContextKey = pending
      ? transactionContextKey(accountAddress, chainId, pending.contractAddress)
      : undefined
    submissionLock.current = pending?.kind ?? null
    approvalContext.current = pending?.kind === 'approval'
      ? { address: accountAddress, chainId, contractAddress: pending.contractAddress }
      : undefined
    distributionContext.current = pending?.kind === 'distribution'
      ? {
          address: accountAddress,
          chainId,
          contractAddress: pending.contractAddress,
          totalRaw: pending.amountRaw,
          recipients: pending.recipients.map(({ address, amountRaw }) => ({
            address,
            amountRaw,
          })),
        }
      : undefined
    queueMicrotask(() => {
      if (
        currentContextKeyRef.current !== currentContextKey
        || contextGeneration.current !== syncGeneration
      ) return
      setApprovalContextKey(pending?.kind === 'approval' ? pendingContextKey : undefined)
      setDistributionContextKey(pending?.kind === 'distribution' ? pendingContextKey : undefined)
      setApproveTxHash(pending?.kind === 'approval' ? pending.txHash : undefined)
      setApproveTxChainId(pending?.kind === 'approval' ? chainId : undefined)
      setDistributeTxHash(pending?.kind === 'distribution' ? pending.txHash : undefined)
      setDistributeTxChainId(pending?.kind === 'distribution' ? chainId : undefined)
      setTxPhase(pending?.kind === 'approval'
        ? 'approving'
        : pending?.kind === 'distribution'
          ? 'distributing'
          : 'idle')
      setError(changed && !pending
        ? 'Wallet account or network changed, or the ArcSplit contract target changed. Review and submit this split again.'
        : '')
    })
  }, [currentContextKey, accountAddress, chainId, network?.contractAddress])

  const isWrongChain = !network
  const isProductionTestnet = isProductionArcEnvironment()
    && chainId === 5042002
  const payouts = recipients.map((recipient) => recipient.amountRaw)
  const fixedTotal = recipients.reduce((sum, recipient) => sum + recipient.amountRaw, 0n)
  const distributionTotal = fixedTotal
  const validRecipients = recipients.length > 0
    && recipients.length <= 50
    && recipients.every((recipient) => isValidAddress(recipient.address) && recipient.amountRaw > 0n)
    && new Set(recipients.map((recipient) => recipient.address.toLowerCase())).size === recipients.length
  const splitMatchesTotal = amountRaw > 0n && fixedTotal === amountRaw && validRecipients
  const needsApproval = !network || allowance < distributionTotal

  // ── Approve ───────────────────────────────────────────────────────────────
  const { writeContract: writeApprove, isPending: approvePending } = useWriteContract()
  const {
    data: approveReceipt,
    error: approveReceiptError,
    isError: approveReceiptFailed,
    isFetching: approveReceiptFetching,
    isLoading: approveConfirming,
    refetch: refetchApproveReceipt,
  } = useWaitForTransactionReceipt({
    hash: approveTxHash,
    chainId: approveTxChainId,
  })

  // ── Distribute ────────────────────────────────────────────────────────────
  const { writeContract: writeDistribute, isPending: distributePending } = useWriteContract()
  const {
    data: distributeReceipt,
    error: distributeReceiptError,
    isError: distributeReceiptFailed,
    isFetching: distributeReceiptFetching,
    isLoading: distributeConfirming,
    refetch: refetchDistributeReceipt,
  } = useWaitForTransactionReceipt({
    hash: distributeTxHash,
    chainId: distributeTxChainId,
  })

  const simulationEnabled = !!network?.contractAddress
    && !!accountAddress
    && splitMatchesTotal
    && allowance >= distributionTotal
    && !allowanceLoading
    && !allowanceFetching
    && !allowanceReadFailed
    && !balanceLoading
    && !balanceFetching
    && !balanceReadFailed
    && balance >= distributionTotal
  const {
    data: distributionSimulation,
    error: distributionSimulationError,
    isFetching: distributionSimulationFetching,
  } = useSimulateContract({
    address: network?.contractAddress,
    abi: ARCSPLIT_FIXED_ABI,
    functionName: 'distributeFixedAmounts',
    args: [
      recipients.map((recipient) => recipient.address as `0x${string}`),
      recipients.map((recipient) => recipient.amountRaw),
    ],
    account: accountAddress,
    chainId: network?.chainId,
    query: { enabled: simulationEnabled, retry: false },
  })

  // Derive the overall phase from transaction receipts where possible
  // to avoid calling setState inside effects
  const distributionContextMatches = distributionContextKey === currentContextKey
  const approvalContextMatches = approvalContextKey === currentContextKey
  const isDone = distributeReceipt?.status === 'success'
    && txPhase === 'distributing'
    && distributionContextMatches
  const approvalReceiptUnknown = approveReceiptFailed
    && txPhase === 'approving'
    && approvalContextMatches
  const distributionReceiptUnknown = distributeReceiptFailed
    && txPhase === 'distributing'
    && distributionContextMatches
  const receiptError = approvalReceiptUnknown
    ? receiptErrorMessage(approveReceiptError, 'approval')
    : distributionReceiptUnknown
      ? receiptErrorMessage(distributeReceiptError, 'distribution')
      : ''
  const preflightMessage = allowanceReadFailed
    ? `Could not read USDC allowance: ${detailedErrorMessage(allowanceReadError)}`
    : balanceReadFailed
      ? `Could not read USDC balance: ${detailedErrorMessage(balanceReadError)}`
      : !splitMatchesTotal
        ? 'Allocated amounts must match the total amount, with valid, unique recipients and positive amounts.'
        : !balanceLoading && !balanceFetching && balance < distributionTotal
          ? 'Insufficient USDC balance.'
          : distributionSimulationError && simulationEnabled
            ? `Distribution preflight failed: ${detailedErrorMessage(distributionSimulationError)}`
            : ''

  const handleApprove = useCallback(() => {
    if (submissionLock.current || txPhase !== 'idle') return
    if (!accountAddress) {
      setError('Connect a wallet before approving USDC.')
      return
    }
    if (allowanceLoading || allowanceFetching || balanceLoading || balanceFetching
      || allowanceReadFailed || balanceReadFailed) {
      setError(preflightMessage || 'USDC allowance or balance could not be verified. No transaction was sent.')
      return
    }
    if (!splitMatchesTotal) {
      setError('Allocated amounts must match the total amount.')
      return
    }
    if (!network?.contractAddress) {
      setError('ArcSplit contract is not configured for this network.')
      return
    }
    if (allowance >= distributionTotal) {
      setError('The current on-chain allowance is already sufficient. No approval is needed.')
      return
    }
    if (balance < distributionTotal) {
      setError('Insufficient USDC balance.')
      return
    }
    const generation = ++submissionGeneration.current
    submissionLock.current = 'approval'
    approvalContext.current = {
      address: accountAddress,
      chainId: network.chainId,
      contractAddress: network.contractAddress,
    }
    const submissionKey = transactionContextKey(accountAddress, network.chainId, network.contractAddress)
    setApprovalContextKey(submissionKey)
    setError('')
    setTxPhase('approving')
    setApproveTxHash(undefined)
    setApproveTxChainId(network.chainId)
    try {
      writeApprove(
        {
          address: network.usdcAddress,
          abi: erc20Abi,
          functionName: 'approve',
          args: [network.contractAddress, distributionTotal],
          chainId: network.chainId,
        },
        {
          onSuccess: (hash) => {
            const existing = getPendingTransaction(accountAddress, network.chainId, network.contractAddress)
            const record = {
              kind: 'approval' as const,
              txHash: hash,
              amountRaw: distributionTotal.toString(),
              contractAddress: network.contractAddress,
              recipients: recipients.map((recipient) => ({
                address: recipient.address,
                amountRaw: recipient.amountRaw.toString(),
              })),
            }
            const recoverySaved = (
              (!existing || existing.txHash === hash)
              ? savePendingTransaction(accountAddress, network.chainId, record)
              : true
            )
            if (submissionGeneration.current !== generation) return
            if (currentContextKeyRef.current !== submissionKey) return
            if (!recoverySaved) {
              setError('Approval was submitted, but this browser could not save its recovery details.')
            }
            setApproveTxHash(hash)
            setApproveTxChainId(network.chainId)
            toast.info('Approval submitted…')
          },
          onError: (err) => {
            if (submissionGeneration.current !== generation) return
            clearPendingTransaction(accountAddress, network.chainId, network.contractAddress)
            if (currentContextKeyRef.current !== submissionKey) return
            submissionLock.current = null
            const msg = transactionErrorMessage(err)
            setError(msg)
            toast.error(msg)
            setTxPhase('idle')
          },
        },
      )
    } catch (err) {
      submissionLock.current = null
      setTxPhase('idle')
      setError(transactionErrorMessage(err))
    }
  }, [
    writeApprove, distributionTotal, network, accountAddress, splitMatchesTotal,
    allowance, balance, recipients, txPhase, allowanceLoading, allowanceFetching,
    balanceLoading, balanceFetching,
    allowanceReadFailed, balanceReadFailed, preflightMessage,
  ])

  const handleDistribute = useCallback(() => {
    if (
      (submissionLock.current && !(submissionLock.current === 'approval' && txPhase === 'idle'))
      || txPhase !== 'idle'
    ) return
    if (isProductionTestnet) {
      setError('Arc Testnet is not available in production. Switch to Arc Mainnet.')
      return
    }
    if (!network?.contractAddress) {
      setError('ArcSplit contract is not configured for this network.')
      return
    }
    if (!accountAddress) {
      setError('Connect a wallet before distributing.')
      return
    }
    if (allowanceLoading || allowanceFetching || balanceLoading || balanceFetching
      || allowanceReadFailed || balanceReadFailed) {
      setError(preflightMessage || 'USDC allowance or balance could not be verified. No transaction was sent.')
      return
    }
    if (!splitMatchesTotal) {
      setError('Allocated amounts must match the total amount.')
      return
    }
    if (allowance < distributionTotal) {
      setError('Insufficient USDC allowance. Approve USDC before distributing.')
      return
    }
    if (balance < distributionTotal) {
      setError('Insufficient USDC balance.')
      return
    }
    if (!distributionSimulation?.request) {
      setError(distributionSimulationError
        ? `Distribution preflight failed: ${detailedErrorMessage(distributionSimulationError)}`
        : 'Distribution preflight is not ready. No transaction was sent.')
      return
    }
    const generation = ++submissionGeneration.current
    submissionLock.current = 'distribution'
    distributionContext.current = {
      address: accountAddress,
      chainId: network.chainId,
      contractAddress: network.contractAddress,
      totalRaw: distributionTotal.toString(),
      recipients: recipients.map((recipient) => ({
        address: recipient.address,
        amountRaw: recipient.amountRaw.toString(),
      })),
    }
    const submissionKey = transactionContextKey(accountAddress, network.chainId, network.contractAddress)
    setDistributionContextKey(submissionKey)
    setError('')
    setTxPhase('distributing')
    setDistributeTxHash(undefined)
    setDistributeTxChainId(network.chainId)
    try {
      writeDistribute(distributionSimulation.request, {
        onSuccess: (hash) => {
          const existing = getPendingTransaction(accountAddress, network.chainId, network.contractAddress)
          const record = {
            kind: 'distribution' as const,
            txHash: hash,
            amountRaw: distributionTotal.toString(),
            contractAddress: network.contractAddress,
            recipients: recipients.map((recipient) => ({
              address: recipient.address,
              amountRaw: recipient.amountRaw.toString(),
            })),
          }
          const recoverySaved = (
            (!existing || existing.txHash === hash)
            ? savePendingTransaction(accountAddress, network.chainId, record)
            : true
          )
          if (submissionGeneration.current !== generation) return
          if (currentContextKeyRef.current !== submissionKey) return
          if (!recoverySaved) {
            setError('Distribution was submitted, but this browser could not save its recovery details.')
          }
          setDistributeTxHash(hash)
          setDistributeTxChainId(network.chainId)
          toast.info('Distribution submitted…')
        },
        onError: (err) => {
          if (submissionGeneration.current !== generation) return
          clearPendingTransaction(accountAddress, network.chainId, network.contractAddress)
          if (currentContextKeyRef.current !== submissionKey) return
          submissionLock.current = null
          const msg = transactionErrorMessage(err)
          setError(msg)
          toast.error(msg)
          setTxPhase('idle')
        },
      })
    } catch (err) {
      submissionLock.current = null
      setTxPhase('idle')
      setError(transactionErrorMessage(err))
    }
  }, [
    writeDistribute, recipients, balance, allowance, splitMatchesTotal,
    distributionTotal, distributionSimulation, distributionSimulationError,
    network, accountAddress, txPhase, allowanceLoading, allowanceFetching,
    balanceLoading, balanceFetching,
    allowanceReadFailed, balanceReadFailed, preflightMessage, isProductionTestnet,
  ])

  const isLoading = approvePending || approveConfirming || distributePending || distributeConfirming
    || isAllowanceRefreshing || allowanceFetching || balanceFetching
  const approveStepDone = !needsApproval || txPhase === 'distributing'
  useEffect(() => {
    if (!approveTxHash || !approvalContextMatches || !approveReceipt?.status
      || handledApprovalHashes.current.has(approveTxHash)
      || allowanceRefreshes.current.has(approveTxHash)) return

    if (approveReceipt.status === 'reverted') {
      handledApprovalHashes.current.add(approveTxHash)
      const submitted = approvalContext.current
      clearPendingTransaction(
        submitted?.address,
        submitted?.chainId,
        submitted?.contractAddress,
      )
      queueMicrotask(() => {
        if (!submitted || currentContextKeyRef.current !== transactionContextKey(
          submitted.address,
          submitted.chainId,
          submitted.contractAddress,
        )) return
        submissionLock.current = null
        setApproveTxHash(undefined)
        setApproveTxChainId(undefined)
        setTxPhase('idle')
        setError('The approval transaction reverted. No approval was confirmed.')
      })
      return
    }

    const submitted = approvalContext.current
    if (!submitted?.address || submitted.chainId === undefined || !submitted.contractAddress) return
    const submittedContractAddress = submitted.contractAddress
    const submittedKey = transactionContextKey(
      submitted.address,
      submitted.chainId,
      submittedContractAddress,
    )
    const refreshId = ++allowanceRefreshId.current
    allowanceRefreshes.current.set(approveTxHash, refreshId)
    queueMicrotask(() => setIsAllowanceRefreshing(true))
    void refetchAllowance()
      .then((result) => {
        if (
          currentContextKeyRef.current !== submittedKey
          || allowanceRefreshId.current !== refreshId
        ) return
        if (result.isError) {
          setError(`Approval confirmed, but allowance refresh failed: ${detailedErrorMessage(result.error)}`)
          return
        }
        handledApprovalHashes.current.add(approveTxHash)
        clearPendingTransaction(submitted.address, submitted.chainId, submittedContractAddress)
        submissionLock.current = null
        setApproveTxHash(undefined)
        setApproveTxChainId(undefined)
        setTxPhase('idle')
        setError('')
        toast.success('USDC approved. Allowance refreshed.')
      })
      .catch((refreshError: unknown) => {
        if (
          currentContextKeyRef.current !== submittedKey
          || allowanceRefreshId.current !== refreshId
        ) return
        setError(`Approval confirmed, but allowance refresh failed: ${detailedErrorMessage(refreshError)}`)
      })
      .finally(() => {
        if (allowanceRefreshes.current.get(approveTxHash) === refreshId) {
          allowanceRefreshes.current.delete(approveTxHash)
        }
        if (
          currentContextKeyRef.current === submittedKey
          && allowanceRefreshId.current === refreshId
        ) setIsAllowanceRefreshing(false)
      })
  }, [
    approveTxHash, approveTxChainId, approveReceipt?.status, approvalContextMatches,
    accountAddress, network?.contractAddress, refetchAllowance, handledApprovalHashes,
  ])

  useEffect(() => {
    if (!distributeTxHash || !distributionContextMatches || distributeReceipt?.status !== 'reverted'
      || handledDistributionHashes.current.has(distributeTxHash)) return
    handledDistributionHashes.current.add(distributeTxHash)
    const submitted = distributionContext.current
    if (submitted?.chainId) {
      const saved = addHistoryEntry(submitted.address, submitted.chainId, {
        txHash: distributeTxHash,
        chainId: submitted.chainId,
        status: 'failed',
        ...(submitted.contractAddress ? { contractAddress: submitted.contractAddress } : {}),
        mode: 'fixed',
        totalRaw: submitted.totalRaw,
        recipients: submitted.recipients,
      })
      if (!saved) toast.error('The reverted distribution was confirmed, but its history could not be saved in this browser.')
      clearPendingTransaction(submitted.address, submitted.chainId, submitted.contractAddress)
    }
    submissionLock.current = null
    queueMicrotask(() => {
      setDistributeTxHash(undefined)
      setDistributeTxChainId(undefined)
      setTxPhase('idle')
      setError('The distribution transaction reverted. No payment was recorded as successful.')
    })
  }, [
    distributeTxHash, distributeTxChainId, distributeReceipt?.status,
    distributionContextMatches, handledDistributionHashes,
  ])

  const refreshedDistributionHash = useRef<`0x${string}` | undefined>()

  useEffect(() => {
    if (!isDone || !distributeTxHash || refreshedDistributionHash.current === distributeTxHash) return
    refreshedDistributionHash.current = distributeTxHash
    void refetchBalance()
  }, [isDone, distributeTxHash, refetchBalance])

  const recordedDistributionHash = useRef<`0x${string}` | undefined>()

  useEffect(() => {
    if (!isDone || !distributeTxHash || recordedDistributionHash.current === distributeTxHash) return
    recordedDistributionHash.current = distributeTxHash
    const submitted = distributionContext.current
    if (!submitted?.chainId) return
    const saved = addHistoryEntry(submitted.address, submitted.chainId, {
      txHash: distributeTxHash,
      chainId: submitted.chainId,
      status: 'success',
      ...(submitted.contractAddress ? { contractAddress: submitted.contractAddress } : {}),
      mode: 'fixed',
      totalRaw: submitted.totalRaw,
      recipients: submitted.recipients,
    })
    if (!saved) toast.error('Payment succeeded, but its history could not be saved in this browser.')
    clearPendingTransaction(submitted.address, submitted.chainId, submitted.contractAddress)
    submissionLock.current = null
  }, [isDone, distributeTxHash])

  const notifiedDistributionHash = useRef<`0x${string}` | undefined>()

  useEffect(() => {
    if (!isDone || !distributeTxHash || notifiedDistributionHash.current === distributeTxHash) return
    notifiedDistributionHash.current = distributeTxHash
    onDistributionConfirmed?.()
  }, [isDone, distributeTxHash, onDistributionConfirmed])

  useEffect(() => {
    if (!isDone || !distributeTxHash || soundedDistributionHashes.has(distributeTxHash)) return
    soundedDistributionHashes.add(distributeTxHash)
    playSuccessSound()
  }, [isDone, distributeTxHash])

  // ── Done state ────────────────────────────────────────────────────────────
  if (isDone) {
    return (
      <div className="success-screen flex flex-col gap-5">
        <div
          className="flex flex-col items-center gap-4 rounded-3xl p-6 text-center sm:p-8"
          style={{ background: 'var(--success-card-bg)', border: '1px solid var(--success-border)', boxShadow: 'var(--success-card-shadow)' }}
        >
          <div
            className="success-mark flex h-16 w-16 items-center justify-center rounded-full"
            style={{ background: 'var(--success-surface)', border: '1px solid var(--success-border)' }}
          >
            <Check className="h-8 w-8" style={{ color: 'var(--success)' }} />
          </div>
          <div>
            <h2 className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>
              Payment Sent
            </h2>
            <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
              <span className="font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>
                {formatUsdc(amountRaw)} USDC
              </span>{' '}
              distributed to {recipients.length} recipient{recipients.length !== 1 ? 's' : ''}
            </p>
          </div>
          {distributeTxHash && (
            <a
              href={txUrl(distributeTxChainId ?? ARC_MAINNET_CHAIN_ID, distributeTxHash)}
              target="_blank"
              rel="noreferrer"
              className="surface-hover inline-flex min-h-10 items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold transition-all"
              style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}
            >
              View on ArcScan <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        {/* Summary */}
        <div
          className="rounded-2xl p-4"
          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
        >
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Payout Summary
          </p>
          <div className="flex flex-col gap-2">
            {recipients.map((r, i) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="mono text-xs" style={{ color: 'var(--ink-2)' }}>
                  {shortAddress(r.address)}
                </span>
                <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--success)' }}>
                  +{formatUsdc(payouts[i] ?? 0n)} USDC
                </span>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={onReset}
          className="min-h-12 w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:brightness-110"
          style={{ background: 'var(--accent-gradient)', boxShadow: '0 8px 22px rgba(103,94,232,0.2)' }}
        >
          Split Another Payment
        </button>
      </div>
    )
  }

  // ── Review state ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="display text-base font-semibold" style={{ color: 'var(--ink)' }}>
            Review &amp; Send
          </h2>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Two steps: Approve USDC, then Distribute
          </p>
        </div>
        <span className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{ color: 'var(--accent-hover)', background: 'var(--info-surface)', border: '1px solid var(--info-border)' }}>
          {network?.name ?? 'Unsupported network'}
        </span>
      </div>

      {/* Amount summary */}
      <div
        className="flex min-w-0 items-center gap-3 rounded-2xl p-4 sm:p-5"
        style={{ background: 'var(--summary-card-bg)', border: '1px solid var(--info-border)' }}
      >
        <TokenUSDC variant="branded" size={32} />
        <div>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Total to split</p>
          <p className="display text-2xl font-bold tabular-nums sm:text-3xl" style={{ color: 'var(--ink)' }}>
            {formatUsdc(amountRaw)}{' '}
            <span className="text-base font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
          </p>
        </div>
      </div>

      {/* Recipient rows */}
      <div
        className="rounded-2xl"
        style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
      >
        <div className="px-4 pt-3 pb-2">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            {recipients.length} Recipient{recipients.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex flex-col">
          {recipients.map((r, i) => (
            <div
              key={r.id}
              className="flex items-center justify-between px-4 py-3"
              style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined }}
            >
              <div className="flex flex-col gap-0.5">
                <span className="mono text-xs" style={{ color: 'var(--ink)' }}>
                  {shortAddress(r.address)}
                </span>
                <span className="text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
                  Exact amount
                </span>
              </div>
              <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>
                {formatUsdc(payouts[i] ?? 0n)} USDC
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Two-step flow indicators */}
      <div className="flex flex-col gap-2.5">
        {/* Step 1: Approve */}
        <div
          className="flex items-center gap-3 rounded-xl px-4 py-3"
          style={{
            background: approveStepDone ? 'var(--success-surface)' : 'var(--surface-muted)',
            border: `1px solid ${approveStepDone ? 'var(--success-border)' : 'var(--border)'}`,
          }}
        >
          <div
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold"
            style={{
              background: approveStepDone ? 'var(--success)' : 'var(--surface-muted)',
              color: approveStepDone ? '#fff' : 'var(--subtle)',
              border: '1.5px solid var(--border)',
            }}
          >
            {approveStepDone ? <Check className="h-4 w-4" /> : '1'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              Approve USDC
            </p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Allow ArcSplit to spend {formatUsdc(distributionTotal)} USDC
            </p>
          </div>
          {(approvePending || approveConfirming) && (
            <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" style={{ color: 'var(--muted)' }} />
          )}
          {approveTxHash && (
            <a
              href={txUrl(approveTxChainId ?? ARC_MAINNET_CHAIN_ID, approveTxHash)}
              target="_blank"
              rel="noreferrer"
              className="flex-shrink-0"
              title="View approval tx"
            >
              <ExternalLink className="h-3.5 w-3.5" style={{ color: 'var(--subtle)' }} />
            </a>
          )}
        </div>

        {/* Step 2: Distribute */}
        <div
          className="flex items-center gap-3 rounded-xl px-4 py-3"
          style={{
            background: txPhase === 'distributing' ? 'var(--info-surface)' : 'var(--surface-muted)',
            border: `1px solid ${txPhase === 'distributing' ? 'var(--info-border)' : 'var(--border)'}`,
            opacity: txPhase === 'idle' || txPhase === 'approving' ? 0.72 : 1,
          }}
        >
          <div
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold"
            style={{
              background: 'var(--surface-muted)',
              color: 'var(--subtle)',
              border: '1.5px solid var(--border)',
            }}
          >
            2
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              Distribute
            </p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Send USDC to {recipients.length} recipient{recipients.length !== 1 ? 's' : ''}
            </p>
          </div>
          {(distributePending || distributeConfirming) && (
            <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" style={{ color: 'var(--muted)' }} />
          )}
          {distributeTxHash && (
            <a
              href={txUrl(distributeTxChainId ?? ARC_MAINNET_CHAIN_ID, distributeTxHash)}
              target="_blank"
              rel="noreferrer"
              className="flex-shrink-0"
              title="View distribution tx"
            >
              <ExternalLink className="h-3.5 w-3.5" style={{ color: 'var(--subtle)' }} />
            </a>
          )}
        </div>
      </div>

      {/* Error */}
      {(error || receiptError || (txPhase === 'idle' && preflightMessage)) && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl px-3 py-2.5"
          style={{
            background: approvalReceiptUnknown || distributionReceiptUnknown ? 'var(--warning-surface)' : 'var(--danger-surface)',
            border: `1px solid ${approvalReceiptUnknown || distributionReceiptUnknown ? 'var(--warning-border)' : 'var(--danger-border)'}`,
          }}
        >
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: approvalReceiptUnknown || distributionReceiptUnknown ? 'var(--warning)' : 'var(--danger)' }} />
          <span className="min-w-0 text-sm leading-relaxed" style={{ color: approvalReceiptUnknown || distributionReceiptUnknown ? 'var(--warning)' : 'var(--danger)' }}>
            {error || receiptError || preflightMessage}
          </span>
        </div>
      )}

      {/* Nav + CTAs */}
      <div className="flex flex-col gap-3">
        {approvalReceiptUnknown ? (
          <button
            onClick={() => { setError(''); void refetchApproveReceipt() }}
            disabled={approveReceiptFetching}
            className="min-h-12 w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--accent-gradient)' }}
          >
            {approveReceiptFetching ? 'Checking approval status…' : 'Retry approval status check'}
          </button>
        ) : distributionReceiptUnknown ? (
          <button
            onClick={() => { setError(''); void refetchDistributeReceipt() }}
            disabled={distributeReceiptFetching}
            className="min-h-12 w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--accent-gradient)' }}
          >
            {distributeReceiptFetching ? 'Checking distribution status…' : 'Retry distribution status check'}
          </button>
        ) : isWrongChain ? (
          <button
            onClick={() => switchChain({ chainId: ARC_MAINNET_CHAIN_ID })}
            disabled={isSwitching}
            className="min-h-12 w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--accent-gradient)' }}
          >
            {isSwitching ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Switching…
              </span>
            ) : (
              'Switch to Arc Mainnet'
            )}
          </button>
        ) : txPhase === 'approving' ? (
          <button
            disabled
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white opacity-60"
            style={{ background: 'var(--accent-gradient)' }}
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            {approveConfirming ? 'Confirming approval…' : 'Approval pending…'}
          </button>
        ) : txPhase === 'distributing' ? (
          <button
            disabled
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white opacity-60"
            style={{ background: 'var(--accent-gradient)' }}
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            {distributeConfirming ? 'Distributing…' : 'Distribution pending…'}
          </button>
        ) : needsApproval ? (
            <button
              onClick={handleApprove}
              disabled={isLoading || allowanceLoading || balanceLoading || allowanceReadFailed
                || balanceReadFailed || !splitMatchesTotal || balance < distributionTotal
                || txPhase !== 'idle'}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: 'var(--accent-gradient)' }}
            >
              {approvePending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Confirm in wallet…
                </>
              ) : approveConfirming ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Confirming…
                </>
              ) : (
                <>
                  Approve USDC <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
        ) : (
          <button
            onClick={handleDistribute}
            disabled={isLoading || allowanceLoading || balanceLoading || allowanceReadFailed
              || balanceReadFailed || !splitMatchesTotal || balance < distributionTotal
              || !distributionSimulation?.request || distributionSimulationFetching
              || txPhase !== 'idle'}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--accent-gradient)' }}
          >
            {distributePending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Confirm in wallet…
              </>
            ) : distributeConfirming ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Distributing…
              </>
            ) : allowanceLoading || balanceLoading || distributionSimulationFetching ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Checking transaction…
              </>
            ) : (
              <>
                Distribute Now <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        )}

        {txPhase === 'idle' && (
          <button
            onClick={onBack}
            className="surface-hover flex min-h-12 items-center justify-center gap-1.5 rounded-2xl py-3 text-sm font-semibold transition-all"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
        )}
      </div>
    </div>
  )
}
