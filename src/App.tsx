import { useState, useCallback, useEffect, useRef } from 'react'
import type { PointerEvent } from 'react'
import { ConnectKitButton } from 'connectkit'
import { Moon, Sun } from 'lucide-react'
import { StepIndicator } from '@/components/StepIndicator'
import { AmountStep } from '@/components/AmountStep'
import { RecipientsStep } from '@/components/RecipientsStep'
import { ReviewStep } from '@/components/ReviewStep'
import { AuroraBackground } from '@/components/AuroraBackground'
import { useAccount } from 'wagmi'
import type { Recipient } from '@/utils/arcsplit'
import { getArcNetwork } from '@/utils/arcsplit'
import { enableSuccessSound } from '@/utils/successSound'

type Step = 0 | 1 | 2
type Theme = 'dark' | 'light'

function getInitialTheme(): Theme {
  try {
    const savedTheme = window.localStorage.getItem('arcsplit-theme')
    if (savedTheme === 'dark' || savedTheme === 'light') return savedTheme
  } catch {
    // Storage may be unavailable; fall back to the user's system preference.
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export default function App() {
  const { chainId, isConnected } = useAccount()
  const network = getArcNetwork(chainId)
  const networkLabel = isConnected
    ? network?.name ?? 'Unsupported network'
    : 'Wallet not connected'
  const [step, setStep] = useState<Step>(0)
  const [amountRaw, setAmountRaw] = useState<bigint>(0n)
  const [recipients, setRecipients] = useState<Recipient[]>([
    { id: 'r1', address: '', sharesBps: 5000 },
    { id: 'r2', address: '', sharesBps: 5000 },
  ])
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const soundUnlockAttempted = useRef(false)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      window.localStorage.setItem('arcsplit-theme', theme)
    } catch {
      // Keep the in-memory theme even when storage is unavailable.
    }
  }, [theme])

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

  const unlockSoundOnInteraction = useCallback(() => {
    if (soundUnlockAttempted.current) return
    soundUnlockAttempted.current = true
    void enableSuccessSound()
  }, [])

  const updateBackgroundParallax = (event: PointerEvent<HTMLDivElement>) => {
    if (
      event.pointerType !== 'mouse' ||
      !window.matchMedia('(hover: hover) and (pointer: fine)').matches
    ) return

    const offsetX = event.clientX / window.innerWidth - 0.5
    const offsetY = event.clientY / window.innerHeight - 0.5
    const style = event.currentTarget.style
    style.setProperty('--parallax-far-x', `${offsetX * -5}px`)
    style.setProperty('--parallax-far-y', `${offsetY * -5}px`)
    style.setProperty('--parallax-mid-x', `${offsetX * -10}px`)
    style.setProperty('--parallax-mid-y', `${offsetY * -8}px`)
    style.setProperty('--parallax-near-x', `${offsetX * -16}px`)
    style.setProperty('--parallax-near-y', `${offsetY * -12}px`)
  }

  const resetBackgroundParallax = (event: PointerEvent<HTMLDivElement>) => {
    const style = event.currentTarget.style
    style.removeProperty('--parallax-far-x')
    style.removeProperty('--parallax-far-y')
    style.removeProperty('--parallax-mid-x')
    style.removeProperty('--parallax-mid-y')
    style.removeProperty('--parallax-near-x')
    style.removeProperty('--parallax-near-y')
  }

  return (
    <div
      className="app-shell min-h-dvh"
      onPointerDownCapture={unlockSoundOnInteraction}
      onKeyDownCapture={unlockSoundOnInteraction}
      onPointerMove={updateBackgroundParallax}
      onPointerLeave={resetBackgroundParallax}
    >
      <AuroraBackground />
      {/* Header */}
      <header
        className="sticky top-0 z-20 px-4 py-3"
        style={{
          background: 'var(--header-bg)',
          backdropFilter: 'blur(20px) saturate(160%)',
          WebkitBackdropFilter: 'blur(20px) saturate(160%)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3 xl:max-w-2xl">
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
              style={{ background: 'var(--brand-mark-bg)', border: '1px solid var(--brand-mark-border)' }}
            >
              <img src="/arcsplit-mark.png" alt="ArcSplit logo mark" className="h-8 w-8 object-contain" />
            </div>
            <div className="min-w-0">
              <span className="brand-wordmark display block text-base font-bold leading-tight" style={{ letterSpacing: '-0.02em' }}>
                ArcSplit
              </span>
              <span className="hidden text-[10px] font-semibold uppercase tracking-[0.16em] sm:block" style={{ color: 'var(--muted)' }}>
                USDC payment splits
              </span>
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              aria-pressed={theme === 'dark'}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{
                color: 'var(--ink-2)',
                background: 'var(--surface-muted)',
                border: '1px solid var(--border)',
              }}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <ConnectKitButton />
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto w-full max-w-lg px-4 py-7 sm:px-6 sm:py-10 xl:max-w-xl">
        {/* Step indicator */}
        <div className="mb-6 flex justify-center sm:mb-7">
          <StepIndicator current={step} />
        </div>

        {/* Card */}
        <div
          className="payment-card rounded-3xl p-4 sm:p-6"
          style={{
            background: 'var(--card-bg)',
            backdropFilter: 'blur(30px) saturate(140%)',
            WebkitBackdropFilter: 'blur(30px) saturate(140%)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          <div key={step} className="step-content">
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
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs leading-relaxed" style={{ color: 'var(--subtle)' }}>
          ArcSplit · Non-custodial · {networkLabel}
          {network && (
            <>
              {' · '}
              <a
                href={`${network.explorerBase}/`}
                target="_blank"
                rel="noreferrer"
                className="underline hover:opacity-70"
              >
                Arc Explorer
              </a>
            </>
          )}
        </p>
      </main>
    </div>
  )
}
