import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { Recipient } from '@/utils/arcsplit'
import {
  addHistoryEntry,
  getHistory,
  getSavedRecipients,
  getTemplates,
  saveRecipient,
  saveTemplate,
} from '@/utils/splitStorage'

vi.mock('wagmi', () => ({
  useAccount: () => ({ chainId: undefined, isConnected: false }),
}))

vi.mock('@/components/WalletPicker', () => ({
  WalletPicker: () => <button type="button">Connect Wallet</button>,
}))

vi.mock('@/components/NetworkSelector', () => ({
  NetworkSelector: () => <div>Network selector</div>,
}))

vi.mock('@/utils/arcsplit', () => ({
  getArcNetwork: () => undefined,
}))

vi.mock('@/utils/successSound', () => ({
  enableSuccessSound: vi.fn(),
}))

vi.mock('@/components/AuroraBackground', () => ({
  AuroraBackground: () => null,
}))

vi.mock('@/components/StepIndicator', () => ({
  StepIndicator: ({ current }: { current: number }) => <div data-testid="send-step">Step {current + 1}</div>,
}))

vi.mock('@/components/AmountStep', () => ({
  AmountStep: ({
    initialAmountRaw,
    onNext,
  }: {
    initialAmountRaw: bigint
    onNext: (amountRaw: bigint) => void
  }) => (
    <div>
      <div>Send interface</div>
      <div data-testid="amount-state">Amount: {initialAmountRaw.toString()}</div>
      <button type="button" onClick={() => onNext(initialAmountRaw || 2_000_000n)}>
        Continue with amount
      </button>
    </div>
  ),
}))

vi.mock('@/components/RecipientsStep', () => ({
  RecipientsStep: ({
    amountRaw,
    recipients,
    onChange,
    onNext,
  }: {
    amountRaw: bigint
    recipients: Recipient[]
    onChange: (recipients: Recipient[]) => void
    onNext: () => void
  }) => (
    <div>
      <div>Recipients interface</div>
      <div data-testid="recipient-state">
        {recipients.map(({ address, amountRaw: recipientAmount }) => `${address}:${recipientAmount}`).join('|')}
      </div>
      <button
        type="button"
        onClick={() => onChange([{
          id: 'draft-recipient',
          address: '0x1111111111111111111111111111111111111111',
          amountRaw,
        }])}
      >
        Set draft recipient
      </button>
      <button type="button" onClick={onNext}>Review draft</button>
    </div>
  ),
}))

vi.mock('@/components/ReviewStep', () => ({
  ReviewStep: ({
    amountRaw,
    recipients,
    onDistributionConfirmed,
  }: {
    amountRaw: bigint
    recipients: Recipient[]
    onDistributionConfirmed?: () => void
  }) => (
    <div>
      <div>Review interface</div>
      <div data-testid="review-state">
        {amountRaw.toString()}:{recipients.map(({ address }) => address).join('|')}
      </div>
      <button type="button" onClick={() => onDistributionConfirmed?.()}>
        Report confirmed distribution
      </button>
    </div>
  ),
}))

vi.mock('@/components/LibraryScreens', () => ({
  AnalyticsScreen: () => <div>Analytics interface</div>,
  SavedScreen: () => <div>Saved interface</div>,
  TemplatesScreen: () => <div>Templates interface</div>,
  HistoryScreen: () => <div>History interface</div>,
}))

beforeEach(() => {
  const createStorage = () => {
    const values = new Map<string, string>()
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() {
        return values.size
      },
    } satisfies Storage
  }
  vi.stubGlobal('localStorage', createStorage())
  vi.stubGlobal('sessionStorage', createStorage())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function prepareDraft() {
  fireEvent.click(screen.getByRole('button', { name: 'Continue with amount' }))
  fireEvent.click(screen.getByRole('button', { name: 'Set draft recipient' }))
  fireEvent.click(screen.getByRole('button', { name: 'Review draft' }))
}

describe('primary section navigation', () => {
  it('defaults to Light Mode and restores a saved Dark Mode preference', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
    }))

    const firstRender = render(<App />)
    expect(document.documentElement.dataset.theme).toBe('light')

    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('arcsplit-theme')).toBe('dark')

    firstRender.unmount()
    render(<App />)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('switches among five dedicated screens and marks the active section', () => {
    render(<App />)
    const navigation = screen.getByRole('navigation', { name: 'Primary navigation' })

    expect(screen.getByText('Send interface')).toBeTruthy()
    expect(navigation.querySelector('[aria-current="page"]')?.textContent).toContain('Send')

    for (const [section, interfaceName] of [
      ['Saved', 'Saved interface'],
      ['Templates', 'Templates interface'],
      ['History', 'History interface'],
      ['Analytics', 'Analytics interface'],
      ['Send', 'Send interface'],
    ]) {
      fireEvent.click(screen.getByRole('button', { name: section }))
      expect(screen.getByText(interfaceName)).toBeTruthy()
      expect(navigation.querySelector('[aria-current="page"]')?.textContent).toContain(section)
    }
  })

  it('gives Analytics a balanced wide layout consistent with History', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Analytics' }))
    expect(screen.getByRole('main').classList.contains('max-w-4xl')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    expect(screen.getByRole('main').classList.contains('max-w-4xl')).toBe(true)
  })

  it('starts a fresh Send flow after confirmed payment and preserves saved data and history', () => {
    const account = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const savedAddress = '0x2222222222222222222222222222222222222222'
    const recipients: Recipient[] = [{ id: 'saved', address: savedAddress, amountRaw: 1n }]
    saveRecipient(account, 5042, { name: 'Saved recipient', address: savedAddress })
    saveTemplate(account, 5042, 'Saved template', recipients)
    addHistoryEntry(account, 5042, {
      txHash: `0x${'a'.repeat(64)}`,
      chainId: 5042,
      status: 'success',
      mode: 'fixed',
      totalRaw: '1',
      recipients: [{ address: savedAddress, amountRaw: '1' }],
    })
    const savedState = {
      recipients: getSavedRecipients(account, 5042),
      templates: getTemplates(account, 5042),
      history: getHistory(account, 5042),
    }

    render(<App />)
    prepareDraft()
    fireEvent.click(screen.getByRole('button', { name: 'Report confirmed distribution' }))
    fireEvent.click(screen.getByRole('button', { name: 'Analytics' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(screen.getByTestId('send-step').textContent).toBe('Step 1')
    expect(screen.getByTestId('amount-state').textContent).toBe('Amount: 0')
    expect(screen.queryByText('Review interface')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Continue with amount' }))
    expect(screen.getByTestId('recipient-state').textContent).toBe(':0|:0')
    expect(getSavedRecipients(account, 5042)).toEqual(savedState.recipients)
    expect(getTemplates(account, 5042)).toEqual(savedState.templates)
    expect(getHistory(account, 5042)).toEqual(savedState.history)
  })

  it('preserves an unfinished Send draft when navigating to Analytics and back', () => {
    render(<App />)
    prepareDraft()
    const draftState = screen.getByTestId('review-state').textContent

    fireEvent.click(screen.getByRole('button', { name: 'Analytics' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(screen.getByTestId('send-step').textContent).toBe('Step 3')
    expect(screen.getByTestId('review-state').textContent).toBe(draftState)
  })
})
