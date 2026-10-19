import { useCallback, useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { erc20Abi } from 'viem'
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
  USDC_ADDRESS,
  ARCSPLIT_ADDRESS,
  ARCSPLIT_ABI,
  ARC_TESTNET_CHAIN_ID,
} from '@/utils/arcsplit'
import { useUsdcAllowance } from '@/hooks/useUsdcAllowance'
import { useUsdcBalance } from '@/hooks/useUsdcBalance'

interface Props {
  amountRaw: bigint
  recipients: Recipient[]
  onBack: () => void
  onReset: () => void
}

// Track which step has been initiated in this session
type TxPhase = 'idle' | 'approving' | 'approved' | 'distributing'

export function ReviewStep({ amountRaw, recipients, onBack, onReset }: Props) {
  const { chainId } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()
  const { raw: allowance, refetch: refetchAllowance } = useUsdcAllowance()
  const { raw: balance, refetch: refetchBalance } = useUsdcBalance()

  const [txPhase, setTxPhase] = useState<TxPhase>('idle')
  const [error, setError] = useState('')
  const [approveTxHash, setApproveTxHash] = useState<`0x${string}` | undefined>()
  const [distributeTxHash, setDistributeTxHash] = useState<`0x${string}` | undefined>()

  const isWrongChain = chainId !== ARC_TESTNET_CHAIN_ID
  const payouts = computePayouts(recipients, amountRaw)
  const needsApproval = allowance < amountRaw

  // ── Approve ───────────────────────────────────────────────────────────────
  const { writeContract: writeApprove, isPending: approvePending } = useWriteContract()
  const { isLoading: approveConfirming, isSuccess: approveSuccess } = useWaitForTransactionReceipt({
    hash: approveTxHash,
  })

  // ── Distribute ────────────────────────────────────────────────────────────
  const { writeContract: writeDistribute, isPending: distributePending } = useWriteContract()
  const { isLoading: distributeConfirming, isSuccess: distributeSuccess } = useWaitForTransactionReceipt({
    hash: distributeTxHash,
  })

  // Derive the overall phase from transaction receipts where possible
  // to avoid calling setState inside effects
  const isDone = distributeSuccess && txPhase === 'distributing'
  const isApproved = (approveSuccess && txPhase === 'approving') || txPhase === 'approved'

  const handleApprove = useCallback(() => {
    setError('')
    setTxPhase('approving')
    writeApprove(
      {
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'approve',
        args: [ARCSPLIT_ADDRESS, amountRaw],
        chainId: ARC_TESTNET_CHAIN_ID,
      },
      {
        onSuccess: (hash) => {
          setApproveTxHash(hash)
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
  }, [writeApprove, amountRaw])

  // When the user sees the approval has confirmed and clicks Distribute,
  // we advance to 'approved' phase so the UI shows the distribute button
  const handleAdvanceToDistribute = useCallback(() => {
    void refetchAllowance()
    setTxPhase('approved')
    toast.success('USDC approved. Ready to distribute.')
  }, [refetchAllowance])

  const handleDistribute = useCallback(() => {
    setError('')
    setTxPhase('distributing')

    if (balance < amountRaw) {
      setError('Insufficient USDC balance.')
      setTxPhase('approved')
      return
    }

    writeDistribute(
      {
        address: ARCSPLIT_ADDRESS,
        abi: ARCSPLIT_ABI,
        functionName: 'distribute',
        args: [
          recipients.map((r) => r.address as `0x${string}`),
          recipients.map((r) => BigInt(r.sharesBps)),
          amountRaw,
        ],
        chainId: ARC_TESTNET_CHAIN_ID,
      },
      {
        onSuccess: (hash) => {
          setDistributeTxHash(hash)
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
  }, [writeDistribute, recipients, amountRaw, balance])

  const isLoading = approvePending || approveConfirming || distributePending || distributeConfirming
  const approveStepDone = !needsApproval || isApproved || txPhase === 'distributing'

  // ── Done state ────────────────────────────────────────────────────────────
  if (isDone) {
    void refetchBalance()
    return (
      <div className="flex flex-col gap-5">
        <div
          className="flex flex-col items-center gap-4 rounded-3xl p-8 text-center"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
        >
          <div
            className="flex h-16 w-16 items-center justify-center rounded-full"
            style={{ background: 'rgba(26,128,71,0.12)' }}
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
              href={txUrl(distributeTxHash)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold transition-all hover:opacity-80"
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
              <div key={r.id} className="flex items-center justify-between">
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
          className="w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99]"
          style={{ background: 'var(--accent)' }}
        >
          Split Another Payment
        </button>
      </div>
    )
  }

  // ── Review state ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="display text-base font-semibold" style={{ color: 'var(--ink)' }}>
          Review &amp; Send
        </h2>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Two steps: Approve USDC, then Distribute
        </p>
      </div>

      {/* Amount summary */}
      <div
        className="flex items-center gap-3 rounded-2xl p-4"
        style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
      >
        <TokenUSDC variant="branded" size={32} />
        <div>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Total to split</p>
          <p className="display text-2xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
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
            background: approveStepDone ? 'rgba(26,128,71,0.06)' : 'var(--surface-muted)',
            border: '1px solid var(--border)',
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
              href={txUrl(approveTxHash)}
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
            background: txPhase === 'distributing' ? 'rgba(18,45,69,0.06)' : 'var(--surface-muted)',
            border: '1px solid var(--border)',
            opacity: txPhase === 'idle' || txPhase === 'approving' ? 0.5 : 1,
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
              href={txUrl(distributeTxHash)}
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
      {error && (
        <div
          className="flex items-center gap-2 rounded-xl px-3 py-2.5"
          style={{ background: 'rgba(186,43,76,0.07)', border: '1px solid rgba(186,43,76,0.18)' }}
        >
          <AlertCircle className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--danger)' }} />
          <span className="text-sm" style={{ color: 'var(--danger)' }}>{error}</span>
        </div>
      )}

      {/* Nav + CTAs */}
      <div className="flex flex-col gap-3">
        {isWrongChain ? (
          <button
            onClick={() => switchChain({ chainId: ARC_TESTNET_CHAIN_ID })}
            disabled={isSwitching}
            className="w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40"
            style={{ background: 'var(--accent)' }}
          >
            {isSwitching ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Switching…
              </span>
            ) : (
              'Switch to Arc Testnet'
            )}
          </button>
        ) : txPhase === 'idle' || txPhase === 'approving' ? (
          /* Show the approval CTA, or "advance to distribute" if approval just confirmed */
          approveSuccess && txPhase === 'approving' ? (
            <button
              onClick={handleAdvanceToDistribute}
              className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99]"
              style={{ background: 'var(--success)' }}
            >
              <Check className="h-4 w-4" /> Approved — Continue
            </button>
          ) : (
            <button
              onClick={handleApprove}
              disabled={isLoading || (!needsApproval && txPhase === 'idle')}
              className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: 'var(--accent)' }}
            >
              {approvePending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Confirm in wallet…
                </>
              ) : approveConfirming ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Confirming…
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
            className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--accent)' }}
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
                Distribute Now <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        )}

        {txPhase === 'idle' && (
          <button
            onClick={onBack}
            className="flex items-center justify-center gap-1.5 rounded-2xl py-3 text-sm font-semibold transition-all hover:opacity-80"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
        )}
      </div>
    </div>
  )
}
