import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { erc20Abi, WaitForTransactionReceiptTimeoutError } from 'viem'
import { Loader2, ArrowLeft, ExternalLink, Check, AlertCircle, ArrowRight } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { toast } from 'sonner'
import {
  Recipient,
  computePayouts,
  formatUsdc,
  shortAddress,
  parseContractError,
  txUrl,
  ARCSPLIT_ABI,
  ARC_MAINNET_CHAIN_ID,
  getArcNetwork,
} from '@/utils/arcsplit'
import { useUsdcAllowance } from '@/hooks/useUsdcAllowance'
import { useUsdcBalance } from '@/hooks/useUsdcBalance'
import { playSuccessSound } from '@/utils/successSound'

interface Props {
  amountRaw: bigint
  recipients: Recipient[]
  onBack: () => void
  onReset: () => void
}

const soundedDistributionHashes = new Set<`0x${string}`>()

// Track which step has been initiated in this session
type TxPhase = 'idle' | 'approving' | 'approved' | 'distributing'

function receiptErrorMessage(error: Error | null, action: string): string {
  if (error instanceof WaitForTransactionReceiptTimeoutError) {
    return `Timed out waiting for the ${action} receipt. The transaction outcome is unknown; check the explorer or retry the status check.`
  }
  return `Could not retrieve the ${action} receipt. The transaction outcome is unknown; check the explorer or retry the status check.`
}

export function ReviewStep({ amountRaw, recipients, onBack, onReset }: Props) {
  const { chainId } = useAccount()
  const network = getArcNetwork(chainId)
  const { switchChain, isPending: isSwitching } = useSwitchChain()
  const { raw: allowance, refetch: refetchAllowance } = useUsdcAllowance()
  const { raw: balance, refetch: refetchBalance } = useUsdcBalance()

  const [txPhase, setTxPhase] = useState<TxPhase>('idle')
  const [error, setError] = useState('')
  const [approveTxHash, setApproveTxHash] = useState<`0x${string}` | undefined>()
  const [approveTxChainId, setApproveTxChainId] = useState<number | undefined>()
  const [distributeTxHash, setDistributeTxHash] = useState<`0x${string}` | undefined>()
  const [distributeTxChainId, setDistributeTxChainId] = useState<number | undefined>()

  const isWrongChain = !network
  const payouts = computePayouts(recipients, amountRaw)
  const needsApproval = !network || allowance < amountRaw

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

  // Derive the overall phase from transaction receipts where possible
  // to avoid calling setState inside effects
  const isDone = distributeReceipt?.status === 'success' && txPhase === 'distributing'
  const isApproved = (approveReceipt?.status === 'success' && txPhase === 'approving') || txPhase === 'approved'
  const approvalReceiptUnknown = approveReceiptFailed && txPhase === 'approving'
  const distributionReceiptUnknown = distributeReceiptFailed && txPhase === 'distributing'
  const approvalReverted = approveReceipt?.status === 'reverted' && txPhase === 'approving'
  const distributionReverted = distributeReceipt?.status === 'reverted' && txPhase === 'distributing'
  const receiptError = approvalReceiptUnknown
    ? receiptErrorMessage(approveReceiptError, 'approval')
    : distributionReceiptUnknown
      ? receiptErrorMessage(distributeReceiptError, 'distribution')
      : approvalReverted
        ? 'The approval transaction reverted. No approval was confirmed.'
        : distributionReverted
          ? 'The distribution transaction reverted. No payment was sent.'
          : ''

  const handleApprove = useCallback(() => {
    if (!network?.contractAddress) {
      setError('ArcSplit contract is not configured for this network.')
      return
    }
    setError('')
    setTxPhase('approving')
    setApproveTxHash(undefined)
    setApproveTxChainId(network.chainId)
    writeApprove(
      {
        address: network.usdcAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [network.contractAddress, amountRaw],
        chainId: network.chainId,
      },
      {
        onSuccess: (hash) => {
          setApproveTxHash(hash)
          setApproveTxChainId(network.chainId)
          toast.info('Approval submitted…')
        },
        onError: (err) => {
          const msg = parseContractError(err)
          if (!msg.includes('cancelled')) {
            setError(msg)
            toast.error(msg)
          }
          setTxPhase('idle')
        },
      }
    )
  }, [writeApprove, amountRaw, network])

  // When the user sees the approval has confirmed and clicks Distribute,
  // we advance to 'approved' phase so the UI shows the distribute button
  const handleAdvanceToDistribute = useCallback(() => {
    void refetchAllowance()
    setTxPhase('approved')
    toast.success('USDC approved. Ready to distribute.')
  }, [refetchAllowance])

  const handleDistribute = useCallback(() => {
    if (!network?.contractAddress) {
      setError('ArcSplit contract is not configured for this network.')
      return
    }
    setError('')
    setTxPhase('distributing')

    if (balance < amountRaw) {
      setError('Insufficient USDC balance.')
      setTxPhase('approved')
      return
    }

    setDistributeTxHash(undefined)
    setDistributeTxChainId(network.chainId)
    writeDistribute(
      {
        address: network.contractAddress,
        abi: ARCSPLIT_ABI,
        functionName: 'distribute',
        args: [
          recipients.map((r) => r.address as `0x${string}`),
          recipients.map((r) => BigInt(r.sharesBps)),
          amountRaw,
        ],
        chainId: network.chainId,
      },
      {
        onSuccess: (hash) => {
          setDistributeTxHash(hash)
          setDistributeTxChainId(network.chainId)
          toast.info('Distribution submitted…')
        },
        onError: (err) => {
          const msg = parseContractError(err)
          if (!msg.includes('cancelled')) {
            setError(msg)
            toast.error(msg)
          }
          setTxPhase('approved')
        },
      }
    )
  }, [writeDistribute, recipients, amountRaw, balance, network])

  const isLoading = approvePending || approveConfirming || distributePending || distributeConfirming
  const approveStepDone = !needsApproval || isApproved || txPhase === 'distributing'
  const refreshedDistributionHash = useRef<`0x${string}` | undefined>()

  useEffect(() => {
    if (!isDone || !distributeTxHash || refreshedDistributionHash.current === distributeTxHash) return
    refreshedDistributionHash.current = distributeTxHash
    void refetchBalance()
  }, [isDone, distributeTxHash, refetchBalance])

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
                  {(r.sharesBps / 100).toFixed(2)}%
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
              Allow ArcSplit to spend {formatUsdc(amountRaw)} USDC
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
      {(error || receiptError) && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl px-3 py-2.5"
          style={{
            background: approvalReceiptUnknown || distributionReceiptUnknown ? 'var(--warning-surface)' : 'var(--danger-surface)',
            border: `1px solid ${approvalReceiptUnknown || distributionReceiptUnknown ? 'var(--warning-border)' : 'var(--danger-border)'}`,
          }}
        >
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: approvalReceiptUnknown || distributionReceiptUnknown ? 'var(--warning)' : 'var(--danger)' }} />
          <span className="min-w-0 text-sm leading-relaxed" style={{ color: approvalReceiptUnknown || distributionReceiptUnknown ? 'var(--warning)' : 'var(--danger)' }}>{error || receiptError}</span>
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
        ) : txPhase === 'idle' || txPhase === 'approving' ? (
          /* Show the approval CTA, or "advance to distribute" if approval just confirmed */
          isApproved && txPhase === 'approving' ? (
            <button
              onClick={handleAdvanceToDistribute}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-slate-950 transition-all hover:brightness-110"
              style={{ background: 'var(--success)' }}
            >
              <Check className="h-4 w-4" /> Approved — Continue
            </button>
          ) : (
            <button
              onClick={handleApprove}
              disabled={isLoading || (!needsApproval && txPhase === 'idle')}
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
              ) : approvalReverted ? (
                <>
                  Retry Approval <ArrowRight className="h-4 w-4" />
                </>
              ) : !needsApproval ? (
                <>
                  <Check className="h-4 w-4" /> Already Approved — Distribute
                </>
              ) : (
                <>
                  Approve USDC <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          )
        ) : (
          <button
            onClick={handleDistribute}
            disabled={isLoading}
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
            ) : (
              <>
                {distributionReverted ? 'Retry Distribution' : 'Distribute Now'} <ArrowRight className="h-4 w-4" />
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
