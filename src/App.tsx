import { useState, useCallback, useEffect, useRef } from 'react'
import type { PointerEvent } from 'react'
import { toast } from 'sonner'
import { Bookmark, ChartNoAxesCombined, History, Moon, PanelsTopLeft, Send, Sun } from 'lucide-react'
import { StepIndicator } from '@/components/StepIndicator'
import { AmountStep } from '@/components/AmountStep'
import { RecipientsStep } from '@/components/RecipientsStep'
import { ReviewStep } from '@/components/ReviewStep'
import { AnalyticsScreen, HistoryScreen, SavedScreen, TemplatesScreen } from '@/components/LibraryScreens'
import { AuroraBackground } from '@/components/AuroraBackground'
import { NetworkSelector } from '@/components/NetworkSelector'
import { WalletPicker } from '@/components/WalletPicker'
import { useAccount } from 'wagmi'
import type { Recipient } from '@/utils/arcsplit'
import { getArcNetwork } from '@/utils/arcsplit'
import type { SavedRecipient } from '@/utils/splitStorage'
import { clearPendingTransaction, getPendingTransaction } from '@/utils/pendingTransaction'
import { enableSuccessSound } from '@/utils/successSound'

type Step = 0 | 1 | 2
type Section = 'send' | 'saved' | 'templates' | 'history' | 'analytics'
type Theme = 'dark' | 'light'

function getInitialTheme(): Theme {
  try {
    const savedTheme = window.localStorage.getItem('arcsplit-theme')
    if (savedTheme === 'dark' || savedTheme === 'light') return savedTheme
  } catch {
    // Storage may be unavailable; keep the default theme.
  }
  return 'light'
}

function createInitialRecipients(): Recipient[] {
  return [
    { id: 'r1', address: '', amountRaw: 0n },
    { id: 'r2', address: '', amountRaw: 0n },
  ]
}

export default function App() {
  const { address, chainId, isConnected } = useAccount()
  const network = getArcNetwork(chainId)
  const networkLabel = isConnected
    ? network?.name ?? 'Unsupported network'
    : 'Wallet not connected'
  const [section, setSection] = useState<Section>('send')
  const [step, setStep] = useState<Step>(0)
  const [amountRaw, setAmountRaw] = useState<bigint>(0n)
  const [recipients, setRecipients] = useState<Recipient[]>(createInitialRecipients)
  const [sendFlowCompleted, setSendFlowCompleted] = useState(false)
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

  useEffect(() => {
    if (!address || !network || step !== 0 || amountRaw !== 0n) return
    const pending = getPendingTransaction(address, chainId, network.contractAddress)
    if (!pending) return

    let active = true
    queueMicrotask(() => {
      if (!active) return
      setAmountRaw(BigInt(pending.amountRaw))
      setRecipients(pending.recipients.map((recipient, index) => ({
        id: `recovered-${index}`,
        address: recipient.address,
        amountRaw: BigInt(recipient.amountRaw),
      })))
      setStep(2)
      setSection('send')
    })
    return () => { active = false }
  }, [address, chainId, network, step, amountRaw])

  const handleAmountNext = useCallback((raw: bigint) => {
    setAmountRaw(raw)
    setStep(1)
  }, [])

  const handleRecipientsNext = useCallback(() => {
    setStep(2)
  }, [])

  const resetSendFlow = useCallback(() => {
    setStep(0)
    setAmountRaw(0n)
    setRecipients(createInitialRecipients())
    setSendFlowCompleted(false)
  }, [])

  const handleReset = useCallback(() => {
    clearPendingTransaction(address, chainId, network?.contractAddress)
    setSection('send')
    resetSendFlow()
  }, [address, chainId, network?.contractAddress, resetSendFlow])

  const handleSectionChange = useCallback((nextSection: Section) => {
    if (section === 'send' && nextSection !== 'send' && sendFlowCompleted) {
      resetSendFlow()
    }
    setSection(nextSection)
  }, [section, sendFlowCompleted, resetSendFlow])

  const handleDistributionConfirmed = useCallback(() => {
    setSendFlowCompleted(true)
  }, [])

  const handleUseSavedRecipient = useCallback((recipient: SavedRecipient) => {
    const emptyRecipient = recipients.find((item) => !item.address)
    if (emptyRecipient) {
      setRecipients(recipients.map((item) =>
        item.id === emptyRecipient.id ? { ...item, address: recipient.address } : item,
      ))
    } else if (recipients.length < 50) {
      setRecipients([
        ...recipients,
        {
          id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          address: recipient.address,
          amountRaw: 0n,
        },
      ])
    } else {
      toast.error('Maximum 50 recipients allowed.')
      return
    }
    setStep(amountRaw > 0n ? 1 : 0)
    setSection('send')
  }, [amountRaw, recipients])

  const handleApplyTemplate = useCallback((nextRecipients: Recipient[], nextAmountRaw: bigint) => {
    setRecipients(nextRecipients)
    setAmountRaw(nextAmountRaw)
    setStep(1)
    setSection('send')
  }, [])

  const unlockSoundOnInteraction = useCallback(() => {
    if (soundUnlockAttempted.current) return
    soundUnlockAttempted.current = true
    void enableSuccessSound()
  }, [])

  const updateBackgroundParallax = (event: PointerEvent<HTMLDivElement>) => {
    if (
      event.pointerType !== 'mouse' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !window.matchMedia('(hover: hover) and (pointer: fine)').matches
    ) return

    const offsetX = event.clientX / window.innerWidth - 0.5
    const offsetY = event.clientY / window.innerHeight - 0.5
    const style = event.currentTarget.style
    style.setProperty('--parallax-far-x', `${offsetX * -3}px`)
    style.setProperty('--parallax-far-y', `${offsetY * -3}px`)
    style.setProperty('--parallax-mid-x', `${offsetX * -6}px`)
    style.setProperty('--parallax-mid-y', `${offsetY * -5}px`)
    style.setProperty('--parallax-near-x', `${offsetX * -9}px`)
    style.setProperty('--parallax-near-y', `${offsetY * -7}px`)
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
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center justify-between gap-3">
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
              <WalletPicker />
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <NetworkSelector />
          </div>
          <nav
            aria-label="Primary navigation"
            className="mt-3 grid grid-cols-5 gap-1.5 rounded-2xl p-1"
            style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
          >
            {([
              ['send', 'Send', Send],
              ['saved', 'Saved', Bookmark],
              ['templates', 'Templates', PanelsTopLeft],
              ['history', 'History', History],
              ['analytics', 'Analytics', ChartNoAxesCombined],
            ] as const).map(([id, label, Icon]) => {
              const active = section === id
              return (
                <button
                  key={id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => handleSectionChange(id)}
                  className="primary-nav-item flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-semibold transition-colors sm:min-h-10 sm:flex-row sm:gap-1.5 sm:text-xs"
                  style={{
                    color: active ? 'var(--ink)' : 'var(--muted)',
                    background: active ? 'var(--surface-strong)' : 'transparent',
                    boxShadow: active ? '0 2px 8px rgba(0,0,0,0.12)' : 'none',
                  }}
                >
                  <Icon
                    className="h-[18px] w-[18px] flex-shrink-0 stroke-[1.75]"
                    style={{ color: active ? 'var(--accent-hover)' : 'currentColor' }}
                    aria-hidden="true"
                  />
                  <span>{label}</span>
                </button>
              )
            })}
          </nav>
        </div>
      </header>

      {/* Main */}
      <main className={`mx-auto w-full px-4 py-7 sm:px-6 sm:py-10 ${section === 'analytics' || section === 'history' ? 'max-w-4xl' : 'max-w-lg xl:max-w-xl'}`}>
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
          {section === 'send' && (
            <>
              <div className="mb-6 flex justify-center sm:mb-7">
                <StepIndicator current={step} />
              </div>
              <div key={step} className="step-content">
                {step === 0 && (
                  <AmountStep
                    key={`${address ?? 'disconnected'}-${chainId ?? 'unsupported'}-${amountRaw}`}
                    initialAmountRaw={amountRaw}
                    onNext={handleAmountNext}
                  />
                )}
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
                    key={`${address ?? 'disconnected'}-${chainId ?? 'unsupported'}-${network?.contractAddress ?? 'no-contract'}-${amountRaw}`}
                    amountRaw={amountRaw}
                    recipients={recipients}
                    onBack={() => setStep(1)}
                    onReset={handleReset}
                    onDistributionConfirmed={handleDistributionConfirmed}
                  />
                )}
              </div>
            </>
          )}
          {section === 'saved' && <SavedScreen onUseRecipient={handleUseSavedRecipient} />}
          {section === 'templates' && (
            <TemplatesScreen
              amountRaw={amountRaw}
              recipients={recipients}
              onApply={handleApplyTemplate}
            />
          )}
          {section === 'history' && <HistoryScreen />}
          {section === 'analytics' && <AnalyticsScreen />}
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
