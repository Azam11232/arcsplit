import { useState, useCallback } from 'react'
import { ConnectKitButton } from 'connectkit'
import { GitFork } from 'lucide-react'
import { StepIndicator } from '@/components/StepIndicator'
import { AmountStep } from '@/components/AmountStep'
import { RecipientsStep } from '@/components/RecipientsStep'
import { ReviewStep } from '@/components/ReviewStep'
import type { Recipient } from '@/utils/arcsplit'

type Step = 0 | 1 | 2

export default function App() {
  const [step, setStep] = useState<Step>(0)
  const [amountRaw, setAmountRaw] = useState<bigint>(0n)
  const [recipients, setRecipients] = useState<Recipient[]>([
    { id: 'r1', address: '', sharesBps: 5000 },
    { id: 'r2', address: '', sharesBps: 5000 },
  ])

  const handleAmountNext = useCallback((raw: bigint) => {
    setAmountRaw(raw)
    setStep(1)
  }, [])

  const handleRecipientsNext = useCallback(() => {
    setStep(2)
  }, [])

  const handleReset = useCallback(() => {
    setStep(0)
    setAmountRaw(0n)
    setRecipients([
      { id: 'r1', address: '', sharesBps: 5000 },
      { id: 'r2', address: '', sharesBps: 5000 },
    ])
  }, [])

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg-gradient)' }}>
      {/* Header */}
      <header
        className="sticky top-0 z-20 px-4 py-3"
        style={{
          background: 'rgba(255,255,255,0.82)',
          backdropFilter: 'blur(20px) saturate(160%)',
          WebkitBackdropFilter: 'blur(20px) saturate(160%)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div className="mx-auto flex max-w-md items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-xl"
              style={{ background: 'var(--accent)' }}
            >
              <GitFork className="h-4 w-4 text-white" />
            </div>
            <span className="display text-base font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
              ArcSplit
            </span>
          </div>
          <ConnectKitButton />
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-md px-4 py-6">
        {/* Step indicator */}
        <div className="mb-6 flex justify-center">
          <StepIndicator current={step} />
        </div>

        {/* Card */}
        <div
          className="rounded-3xl p-5"
          style={{
            background: 'rgba(255,255,255,0.88)',
            backdropFilter: 'blur(30px) saturate(180%)',
            WebkitBackdropFilter: 'blur(30px) saturate(180%)',
            border: '1px solid var(--border)',
            boxShadow: '0 2px 24px rgba(18,45,69,0.07)',
          }}
        >
          {step === 0 && <AmountStep onNext={handleAmountNext} />}
          {step === 1 && (
            <RecipientsStep
              amountRaw={amountRaw}
              recipients={recipients}
              onChange={setRecipients}
              onNext={handleRecipientsNext}
              onBack={() => setStep(0)}
            />
          )}
          {step === 2 && (
            <ReviewStep
              amountRaw={amountRaw}
              recipients={recipients}
              onBack={() => setStep(1)}
              onReset={handleReset}
            />
          )}
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs" style={{ color: 'var(--subtle)' }}>
          ArcSplit · Non-custodial · Arc Testnet ·{' '}
          <a
            href="https://explorer.testnet.arc.io"
            target="_blank"
            rel="noreferrer"
            className="underline hover:opacity-70"
          >
            ArcScan
          </a>
        </p>
      </main>
    </div>
  )
}
