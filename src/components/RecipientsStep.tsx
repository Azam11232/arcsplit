import { useCallback, useState } from 'react'
import { Plus, Trash2, ArrowRight, ArrowLeft, AlertCircle, UserPlus, Bookmark } from 'lucide-react'
import { useAccount } from 'wagmi'
import { toast } from 'sonner'
import { getArcNetwork, getUsdcInputError, isValidAddress, formatUsdc, parseUsdc, splitFixedAmountsEvenly } from '@/utils/arcsplit'
import type { Recipient } from '@/utils/arcsplit'
import { saveRecipient } from '@/utils/splitStorage'

interface Props {
  amountRaw: bigint
  recipients: Recipient[]
  onChange: (r: Recipient[]) => void
  onNext: () => void
  onBack: () => void
}

interface AmountDraft {
  value: string
  amountRaw: bigint
  error?: string
}

function generateId() {
  return Math.random().toString(36).slice(2, 9)
}

function shortName(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function RecipientsStep({ amountRaw, recipients, onChange, onNext, onBack }: Props) {
  const { address: accountAddress, chainId } = useAccount()
  const canSaveRecipient = !!accountAddress && !!getArcNetwork(chainId)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [amountDrafts, setAmountDrafts] = useState<Record<string, AmountDraft>>({})
  const [globalError, setGlobalError] = useState('')
  const fixedTotal = recipients.reduce((sum, recipient) => sum + recipient.amountRaw, 0n)
  const fixedRemaining = amountRaw - fixedTotal

  const addRecipient = useCallback(() => {
    if (recipients.length >= 50) return
    const id = generateId()
    onChange([...recipients, {
      id,
      address: '',
      amountRaw: fixedRemaining > 0n ? fixedRemaining : 0n,
    }])
    setGlobalError('')
  }, [recipients, fixedRemaining, onChange])

  const removeRecipient = useCallback(
    (id: string) => {
      const next = recipients.filter((r) => r.id !== id)
      setErrors((e) => {
        const copy = { ...e }
        delete copy[id]
        return copy
      })
      setAmountDrafts((drafts) => {
        const copy = { ...drafts }
        delete copy[id]
        return copy
      })
      onChange(next)
      setGlobalError('')
    },
    [recipients, onChange]
  )

  const updateAddress = useCallback(
    (id: string, address: string) => {
      onChange(recipients.map((r) => (r.id === id ? { ...r, address } : r)))
      setErrors((e) => ({ ...e, [id]: '' }))
    },
    [recipients, onChange]
  )

  const updateFixedAmount = useCallback(
    (id: string, raw: string) => {
      const error = getUsdcInputError(raw)
      let amount = 0n
      if (!error && raw !== '' && raw !== '.') {
        try {
          amount = parseUsdc(raw)
        } catch {
          setAmountDrafts((drafts) => ({
            ...drafts,
            [id]: { value: raw, amountRaw: 0n, error: 'Enter a valid USDC amount.' },
          }))
          onChange(recipients.map((recipient) =>
            recipient.id === id ? { ...recipient, amountRaw: 0n } : recipient,
          ))
          setGlobalError('')
          return
        }
      }
      setAmountDrafts((drafts) => ({
        ...drafts,
        [id]: { value: raw, amountRaw: error ? 0n : amount, error },
      }))
      setErrors((current) => ({ ...current, [id]: '' }))
      onChange(recipients.map((recipient) =>
        recipient.id === id ? { ...recipient, amountRaw: error ? 0n : amount } : recipient,
      ))
      setGlobalError('')
    },
    [recipients, onChange],
  )

  const setFixedEqual = useCallback(() => {
    if (recipients.length === 0) return
    const equalAmounts = splitFixedAmountsEvenly(amountRaw, recipients.length)
    setAmountDrafts({})
    setErrors({})
    if (equalAmounts.length > 0 && equalAmounts.some((amount) => amount === 0n) && equalAmounts.length > 1) {
      setGlobalError('Cannot divide this amount equally into more than one positive USDC payout.')
    }
    onChange(recipients.map((recipient, index) => ({
      ...recipient,
      amountRaw: equalAmounts[index] ?? 0n,
    })))
    if (equalAmounts.every((amount) => amount > 0n)) setGlobalError('')
  }, [amountRaw, recipients, onChange])

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {}
    let ok = true

    if (recipients.length === 0) {
      setGlobalError('Add at least one recipient.')
      return false
    }

    const seen = new Set<string>()
    for (const r of recipients) {
      const draft = amountDrafts[r.id]?.amountRaw === r.amountRaw ? amountDrafts[r.id] : undefined
      if (draft?.error) {
        newErrors[r.id] = draft.error
        ok = false
      }
      if (!r.address) {
        newErrors[r.id] = 'Enter a wallet address.'
        ok = false
      } else if (!isValidAddress(r.address)) {
        newErrors[r.id] = r.address.toLowerCase() === '0x0000000000000000000000000000000000000000'
          ? 'The zero address cannot receive USDC.'
          : 'Invalid Ethereum address.'
        ok = false
      } else if (seen.has(r.address.toLowerCase())) {
        newErrors[r.id] = 'Duplicate address.'
        ok = false
      } else {
        seen.add(r.address.toLowerCase())
      }
      if (r.amountRaw === 0n) {
        if (!newErrors[r.id]) newErrors[r.id] = 'Amount must be greater than zero.'
        ok = false
      }
    }

    if (fixedTotal !== amountRaw) {
      setGlobalError(
        fixedRemaining > 0n
          ? `${formatUsdc(fixedRemaining)} USDC remaining to allocate.`
          : `Over-allocation by ${formatUsdc(-fixedRemaining)} USDC.`,
      )
      ok = false
    } else {
      setGlobalError('')
    }

    setErrors(newErrors)
    return ok
  }, [recipients, amountDrafts, fixedTotal, amountRaw, fixedRemaining])

  const handleNext = useCallback(() => {
    if (validate()) onNext()
  }, [validate, onNext])
  const hasInvalidAmountInput = recipients.some((recipient) => {
    const draft = amountDrafts[recipient.id]
    return draft?.amountRaw === recipient.amountRaw && !!draft.error
  })

  return (
    <div className="flex flex-col gap-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="display text-base font-semibold" style={{ color: 'var(--ink)' }}>
            Recipients
          </h2>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Splitting{' '}
            <span className="font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>
              {formatUsdc(amountRaw)} USDC
            </span>
          </p>
        </div>
        {recipients.length > 1 && (
          <button
            onClick={setFixedEqual}
            className="rounded-xl px-3 py-1.5 text-xs font-semibold transition-all hover:opacity-80"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}
          >
            Split equally
          </button>
        )}
      </div>

      {/* Recipient rows */}
      <div className="flex flex-col gap-3">
        {recipients.map((r, idx) => {
          const rowError = errors[r.id]
          const amountDraft = amountDrafts[r.id]?.amountRaw === r.amountRaw
            ? amountDrafts[r.id]
            : undefined
          const message = amountDraft?.error || rowError
          return (
            <div
              key={r.id}
              className="recipient-card rounded-2xl p-4 sm:p-5"
              style={{
                background: 'var(--surface-strong)',
                border: message ? '1.5px solid var(--danger)' : '1.5px solid var(--border)',
                backdropFilter: 'blur(10px)',
              }}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                  Recipient {idx + 1}
                </span>
                {recipients.length > 1 && (
                  <button
                    onClick={() => removeRecipient(r.id)}
                    className="flex h-10 w-10 items-center justify-center rounded-xl transition-all hover:bg-rose-400/10 hover:opacity-100"
                    style={{ color: 'var(--danger)' }}
                    aria-label={`Remove recipient ${idx + 1}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Address */}
              <input
                type="text"
                value={r.address}
                onChange={(e) => updateAddress(r.id, e.target.value.trim())}
                placeholder="0x…"
                className="mono w-full min-w-0 rounded-xl bg-transparent px-3 py-3 text-sm outline-none sm:text-base"
                style={{
                  color: 'var(--ink)',
                  background: 'var(--surface-muted)',
                  border: '1px solid var(--border)',
                }}
                aria-label={`Recipient ${idx + 1} address`}
              />

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amountDraft?.value ?? (r.amountRaw > 0n ? formatUsdc(r.amountRaw) : '')}
                    onChange={(event) => updateFixedAmount(r.id, event.target.value)}
                    placeholder="0.00"
                    className="w-32 rounded-xl px-3 py-2.5 text-sm font-semibold tabular-nums outline-none"
                    style={{ color: 'var(--ink)', background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
                    aria-label={`Recipient ${idx + 1} USDC amount`}
                    aria-invalid={!!amountDraft?.error || !!rowError}
                  />
                  <span className="text-sm font-medium" style={{ color: 'var(--muted)' }}>USDC</span>
                </div>
                {canSaveRecipient && r.address && isValidAddress(r.address) && (
                  <button
                    type="button"
                    onClick={() => {
                      saveRecipient(accountAddress, chainId, { name: shortName(r.address), address: r.address })
                      toast.success('Recipient saved for this wallet and network.')
                    }}
                    className="flex h-9 items-center gap-1 rounded-xl px-2 text-[11px] font-semibold"
                    style={{ color: 'var(--accent-hover)', background: 'var(--info-surface)', border: '1px solid var(--border)' }}
                  >
                    <Bookmark className="h-3 w-3" /> Save
                  </button>
                )}
              </div>

              {message && (
                <p role="alert" className="mt-2 rounded-lg px-2.5 py-2 text-xs leading-relaxed" style={{ color: 'var(--danger)', background: 'var(--danger-surface)' }}>
                  {message}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {/* Add recipient */}
      {recipients.length < 50 && (
        <button
          onClick={addRecipient}
          className="surface-hover flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold transition-all hover:border-[var(--border-strong)]"
          style={{
            background: 'var(--surface-muted)',
            border: '1.5px dashed var(--border)',
            color: 'var(--ink-2)',
          }}
        >
          {recipients.length === 0 ? (
            <>
              <UserPlus className="h-4 w-4" /> Add First Recipient
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" /> Add Recipient
            </>
          )}
        </button>
      )}

      <div
        className="rounded-xl px-4 py-3"
        style={{
          background: fixedTotal === amountRaw ? 'var(--success-surface)' : fixedTotal > amountRaw ? 'var(--danger-surface)' : 'var(--warning-surface)',
          border: `1px solid ${fixedTotal === amountRaw ? 'var(--success-border)' : fixedTotal > amountRaw ? 'var(--danger-border)' : 'var(--warning-border)'}`,
        }}
        aria-live="polite"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium" style={{ color: fixedTotal === amountRaw ? 'var(--success)' : fixedTotal > amountRaw ? 'var(--danger)' : 'var(--warning)' }}>
            {fixedTotal === amountRaw ? 'Allocation complete' : fixedTotal > amountRaw ? 'Over-allocation' : 'Remaining'}
          </span>
          <span className="display text-sm font-bold tabular-nums" style={{ color: fixedTotal === amountRaw ? 'var(--success)' : fixedTotal > amountRaw ? 'var(--danger)' : 'var(--warning)' }}>
            {formatUsdc(fixedTotal)} / {formatUsdc(amountRaw)} USDC allocated
          </span>
        </div>
        {fixedRemaining !== 0n && (
          <p
            role={fixedRemaining < 0n ? 'alert' : 'status'}
            className="mt-1 text-right text-xs font-semibold tabular-nums"
            style={{ color: fixedRemaining > 0n ? 'var(--warning)' : 'var(--danger)' }}
          >
            {fixedRemaining > 0n
              ? `${formatUsdc(fixedRemaining)} USDC remaining`
              : `Over-allocation by ${formatUsdc(-fixedRemaining)} USDC`}
          </p>
        )}
      </div>

      {/* Global error */}
      {globalError && (
        <div role="alert" className="flex items-start gap-2 rounded-xl px-3 py-2.5" style={{ background: 'var(--danger-surface)', border: '1px solid var(--danger-border)' }}>
          <AlertCircle className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--danger)' }} />
          <span className="min-w-0 text-sm leading-relaxed" style={{ color: 'var(--danger)' }}>{globalError}</span>
        </div>
      )}

      {/* Nav buttons */}
      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="surface-hover flex min-h-12 items-center gap-1.5 rounded-2xl px-4 py-3.5 text-sm font-semibold transition-all sm:px-5"
          style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <button
          onClick={handleNext}
          disabled={recipients.length === 0 || fixedTotal !== amountRaw || hasInvalidAmountInput}
          className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: 'var(--accent-gradient)', boxShadow: '0 8px 22px rgba(103,94,232,0.18)' }}
        >
          Review Split <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
