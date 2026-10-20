import { useCallback, useState } from 'react'
import { Plus, Trash2, ArrowRight, ArrowLeft, AlertCircle, UserPlus } from 'lucide-react'
import { Recipient, isValidAddress, formatUsdc, computePayouts } from '@/utils/arcsplit'

interface Props {
  amountRaw: bigint
  recipients: Recipient[]
  onChange: (r: Recipient[]) => void
  onNext: () => void
  onBack: () => void
}

function generateId() {
  return Math.random().toString(36).slice(2, 9)
}

function sumBps(recipients: Recipient[]) {
  return recipients.reduce((s, r) => s + r.sharesBps, 0)
}

export function RecipientsStep({ amountRaw, recipients, onChange, onNext, onBack }: Props) {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [globalError, setGlobalError] = useState('')

  const payouts = computePayouts(recipients, amountRaw)
  const total = sumBps(recipients)
  const remaining = 10000 - total

  const addRecipient = useCallback(() => {
    if (recipients.length >= 50) return
    const id = generateId()
    // Auto-assign remaining share to the new recipient, but never exceed 10000
    const auto = Math.max(0, Math.min(remaining, 10000 - sumBps(recipients)))
    onChange([...recipients, { id, address: '', sharesBps: auto }])
    setGlobalError('')
  }, [recipients, remaining, onChange])

  const removeRecipient = useCallback(
    (id: string) => {
      const next = recipients.filter((r) => r.id !== id)
      setErrors((e) => {
        const copy = { ...e }
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

  const updateShares = useCallback(
    (id: string, raw: string) => {
      const val = raw.replace(/[^0-9]/g, '')
      const num = Math.min(10000, Math.max(0, parseInt(val || '0', 10)))
      onChange(recipients.map((r) => (r.id === id ? { ...r, sharesBps: num } : r)))
      setGlobalError('')
    },
    [recipients, onChange]
  )

  const setEqual = useCallback(() => {
    if (recipients.length === 0) return
    const base = Math.floor(10000 / recipients.length)
    const rem = 10000 - base * (recipients.length - 1)
    onChange(
      recipients.map((r, i) => ({
        ...r,
        sharesBps: i === recipients.length - 1 ? rem : base,
      }))
    )
    setGlobalError('')
  }, [recipients, onChange])

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {}
    let ok = true

    if (recipients.length === 0) {
      setGlobalError('Add at least one recipient.')
      return false
    }

    const seen = new Set<string>()
    for (const r of recipients) {
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
      if (r.sharesBps === 0) {
        newErrors[r.id] = (newErrors[r.id] ? newErrors[r.id] + ' ' : '') + 'Share must be > 0.'
        ok = false
      }
    }

    if (total !== 10000) {
      setGlobalError(
        `Shares must add up to 100% (10,000 bps). Currently ${(total / 100).toFixed(2)}%.`
      )
      ok = false
    } else {
      setGlobalError('')
    }

    setErrors(newErrors)
    return ok
  }, [recipients, total])

  const handleNext = useCallback(() => {
    if (validate()) onNext()
  }, [validate, onNext])

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
            onClick={setEqual}
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
          const payout = payouts[idx] ?? 0n
          const rowError = errors[r.id]
          return (
            <div
              key={r.id}
              className="recipient-card rounded-2xl p-4 sm:p-5"
              style={{
                background: 'var(--surface-strong)',
                border: rowError ? '1.5px solid var(--danger)' : '1.5px solid var(--border)',
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

              {/* Share + payout */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={r.sharesBps === 0 ? '' : r.sharesBps}
                    onChange={(e) => updateShares(r.id, e.target.value)}
                    placeholder="bps"
                    className="w-24 max-w-[40%] rounded-xl px-3 py-2.5 text-sm font-semibold tabular-nums outline-none"
                    style={{
                      color: 'var(--ink)',
                      background: 'var(--surface-muted)',
                      border: '1px solid var(--border)',
                    }}
                    aria-label={`Recipient ${idx + 1} basis points`}
                  />
                  <span className="whitespace-nowrap text-sm font-medium tabular-nums" style={{ color: 'var(--muted)' }}>
                    = {(r.sharesBps / 100).toFixed(2)}%
                  </span>
                </div>
                <span className="ml-auto whitespace-nowrap text-sm font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>
                  {formatUsdc(payout)} USDC
                </span>
              </div>

              {rowError && (
                <p role="alert" className="mt-2 rounded-lg px-2.5 py-2 text-xs leading-relaxed" style={{ color: 'var(--danger)', background: 'var(--danger-surface)' }}>
                  {rowError}
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

      {/* Share total indicator */}
      {recipients.length > 0 && (
        <div
          className="flex items-center justify-between rounded-xl px-4 py-2.5"
          style={{
            background: total === 10000 ? 'var(--success-surface)' : 'var(--danger-surface)',
            border: `1px solid ${total === 10000 ? 'var(--success-border)' : 'var(--danger-border)'}`,
          }}
        >
          <span className="text-xs font-medium" style={{ color: total === 10000 ? 'var(--success)' : 'var(--danger)' }}>
            {total === 10000 ? 'Shares add up to 100%' : `Remaining: ${(remaining / 100).toFixed(2)}%`}
          </span>
          <span
            className="display text-sm font-bold tabular-nums"
            style={{ color: total === 10000 ? 'var(--success)' : 'var(--danger)' }}
          >
            {(total / 100).toFixed(2)}% / 100%
          </span>
        </div>
      )}

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
          disabled={recipients.length === 0}
          className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: 'var(--accent-gradient)', boxShadow: '0 8px 22px rgba(103,94,232,0.18)' }}
        >
          Review Split <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
