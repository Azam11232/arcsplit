import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AnalyticsScreen,
  HistoryScreen,
  SavedScreen,
  TemplatesScreen,
} from './LibraryScreens'
import {
  addHistoryEntry,
  getHistory,
  getSavedRecipients,
  getTemplates,
  saveRecipient,
} from '@/utils/splitStorage'
import {
  ARC_MAINNET_CHAIN_ID,
  ARC_TESTNET_CHAIN_ID,
  ARCSPLIT_MAINNET_LEGACY_ADDRESS,
  ARCSPLIT_MAINNET_NEXT_ADDRESS,
  getArcNetwork,
} from '@/utils/arcsplit'
import { downloadPaymentReceipt } from '@/utils/paymentReceipt'
import { formatUtcDayLabel, formatUtcMonthLabel } from '@/utils/analytics'
import type { OnchainDistributionRecord } from '@/utils/onchainAnalytics'

const mocks = vi.hoisted(() => ({
  account: vi.fn(() => ({
    address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`,
    chainId: 5042,
  })),
  onchainAnalytics: vi.fn(),
  publicClient: {
    chain: { id: 5042 },
    getTransaction: vi.fn(),
    getTransactionReceipt: vi.fn(),
  },
}))

vi.mock('wagmi', () => ({
  useAccount: mocks.account,
  usePublicClient: () => mocks.publicClient,
}))

vi.mock('@/hooks/useOnchainAnalytics', () => ({
  useOnchainAnalytics: mocks.onchainAnalytics,
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/utils/paymentReceipt', () => ({
  downloadPaymentReceipt: vi.fn(),
}))

const alice = '0x1111111111111111111111111111111111111111'
const bob = '0x2222222222222222222222222222222222222222'
const activeMainnetContract = getArcNetwork(ARC_MAINNET_CHAIN_ID)!.contractAddress
const activeTestnetContract = getArcNetwork(ARC_TESTNET_CHAIN_ID)!.contractAddress

function confirmedDistribution(
  txHash: `0x${string}`,
  createdAt = Date.UTC(2026, 10, 19, 12),
): OnchainDistributionRecord {
  return {
    id: `5042:${txHash}:0`,
    chainId: 5042,
    contractAddress: '0x4444444444444444444444444444444444444444',
    networkName: 'Arc Mainnet',
    payer: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    txHash,
    blockNumber: 12n,
    blockHash: `0x${'c'.repeat(64)}`,
    logIndex: 0,
    createdAt,
    totalRaw: '1000000',
    recipients: [{ address: alice, amountRaw: '1000000' }],
    status: 'success',
    verificationStatus: 'receipt-verified',
  }
}

beforeEach(() => {
  vi.mocked(downloadPaymentReceipt).mockClear()
  mocks.publicClient.getTransaction.mockReset()
  mocks.publicClient.getTransactionReceipt.mockReset()
  mocks.publicClient.getTransaction.mockResolvedValue({
    to: activeMainnetContract,
  })
  mocks.publicClient.getTransactionReceipt.mockResolvedValue({
    status: 'success',
  })
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size
    },
  } satisfies Storage)
  mocks.account.mockReturnValue({
    address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    chainId: 5042,
  })
  mocks.onchainAnalytics.mockReturnValue({
    state: {
      status: 'ready',
      contextKey: 'mainnet-wallet',
      records: [],
      deploymentBlock: 1n,
      scannedThroughBlock: 100n,
    },
    retry: vi.fn(),
    network: {
      name: 'Arc Mainnet',
      analyticsContractAddresses: [activeMainnetContract],
    },
  })
})

afterEach(cleanup)

describe('Analytics screen storage startup', () => {
  it('loads combined library storage once when Analytics mounts', () => {
    const getItem = vi.spyOn(globalThis.localStorage, 'getItem')

    render(<AnalyticsScreen />)

    expect(getItem).toHaveBeenCalledTimes(1)
  })
})

describe('Saved recipients screen', () => {
  it('adds, reuses, and removes recipients independently', () => {
    const onUseRecipient = vi.fn()
    render(<SavedScreen onUseRecipient={onUseRecipient} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Recipient name' }), {
      target: { value: 'Alice' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Recipient wallet address' }), {
      target: { value: alice },
    })
    fireEvent.click(screen.getByRole('button', { name: /save recipient/i }))

    expect(screen.getByText('Alice')).toBeTruthy()
    expect(getSavedRecipients('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 5042)).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: /use in send/i }))
    expect(onUseRecipient).toHaveBeenCalledWith(expect.objectContaining({ name: 'Alice', address: alice }))

    fireEvent.click(screen.getByRole('button', { name: 'Remove Alice' }))
    expect(screen.getByText('No saved recipients yet')).toBeTruthy()
  })

  it('reloads only the active wallet and network recipient list', () => {
    const account = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    saveRecipient(account, 5042, { name: 'Mainnet Alice', address: alice })
    saveRecipient(account, 5042002, { name: 'Testnet Bob', address: bob })

    const view = render(<SavedScreen onUseRecipient={vi.fn()} />)
    expect(screen.getByText('Mainnet Alice')).toBeTruthy()

    mocks.account.mockReturnValue({
      address: account,
      chainId: 5042002,
    })
    view.rerender(<SavedScreen onUseRecipient={vi.fn()} />)

    expect(screen.getByText('Testnet Bob')).toBeTruthy()
    expect(screen.queryByText('Mainnet Alice')).toBeNull()
  })
})

describe('Templates screen', () => {
  it('saves and applies exact manual allocations independently', () => {
    const onApply = vi.fn()
    const recipients = [
      { id: 'alice', address: alice, amountRaw: 1_000_000n },
      { id: 'bob', address: bob, amountRaw: 500_000n },
    ]
    render(<TemplatesScreen amountRaw={1_500_000n} recipients={recipients} onApply={onApply} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Template name' }), {
      target: { value: 'Lunch' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save current split/i }))

    expect(screen.getByText('Lunch')).toBeTruthy()
    expect(getTemplates('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 5042)[0]).toMatchObject({
      mode: 'fixed',
      recipients: [
        { address: alice, amountRaw: '1000000' },
        { address: bob, amountRaw: '500000' },
      ],
    })

    fireEvent.click(screen.getByRole('button', { name: /use in send/i }))
    expect(onApply).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ address: alice, amountRaw: 1_000_000n }),
        expect.objectContaining({ address: bob, amountRaw: 500_000n }),
      ]),
      1_500_000n,
    )
  })
})

describe('History screen', () => {
  it('defaults the chart to the current month and switches only the chart to the previous month', () => {
    const now = new Date()
    const currentMonth = now.toISOString().slice(0, 7)
    const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
      .toISOString()
      .slice(0, 7)
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12)
    const monthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 12)
    const previousMonthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 12)
    const nextMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 12)
    const records = [
      confirmedDistribution(`0x${'a'.repeat(64)}`, previousMonthEnd),
      confirmedDistribution(`0x${'b'.repeat(64)}`, monthStart),
      confirmedDistribution(`0x${'c'.repeat(64)}`, monthEnd),
      confirmedDistribution(`0x${'d'.repeat(64)}`, nextMonthStart),
    ]
    mocks.onchainAnalytics.mockReturnValue({
      state: {
        status: 'ready',
        contextKey: 'mainnet-wallet',
        records,
        deploymentBlock: 1n,
        scannedThroughBlock: 100n,
      },
      retry: vi.fn(),
      refresh: vi.fn(),
      network: {
        name: 'Arc Mainnet',
        analyticsContractAddresses: [activeMainnetContract],
      },
    })

    render(<AnalyticsScreen />)

    const monthLabel = formatUtcMonthLabel(currentMonth)
    const monthRange = screen.getByRole('combobox', { name: 'Date range' })
    expect(monthRange).toHaveProperty('value', 'month')
    const chartMonth = screen.getByRole('combobox', { name: 'Chart month' })
    expect(chartMonth).toHaveProperty('value', currentMonth)
    expect([...chartMonth.querySelectorAll('option')].map((option) => option.value)).toEqual([
      currentMonth,
      previousMonth,
    ])
    expect(screen.getByText('Total USDC distributed').closest('article')?.textContent).toContain('2.00 USDC')
    expect(screen.getByText('Confirmed distributions').closest('article')?.textContent).toContain('2')

    const chart = screen.getByRole('group', { name: `Daily Distributions · ${monthLabel} daily chart` })
    expect(chart.querySelectorAll('[role="img"]')).toHaveLength(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate(),
    )
    expect(within(chart).getByRole('img', {
      name: `${formatUtcDayLabel(new Date(monthStart).toISOString().slice(0, 10))}: 1.00 USDC verified`,
    })).toBeTruthy()
    expect(within(chart).getByRole('img', {
      name: `${formatUtcDayLabel(new Date(monthEnd).toISOString().slice(0, 10))}: 1.00 USDC verified`,
    })).toBeTruthy()
    expect(chart.closest('article')?.textContent).toContain('2.00 USDC')

    fireEvent.change(chartMonth, { target: { value: previousMonth } })
    const previousChart = screen.getByRole('group', {
      name: `Daily Distributions · ${formatUtcMonthLabel(previousMonth)} daily chart`,
    })
    expect(previousChart.querySelectorAll('[role="img"]')).toHaveLength(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).getUTCDate(),
    )
    expect(within(previousChart).getByRole('img', {
      name: `${formatUtcDayLabel(new Date(previousMonthEnd).toISOString().slice(0, 10))}: 1.00 USDC verified`,
    })).toBeTruthy()
    expect(previousChart.closest('article')?.textContent).toContain('1.00 USDC')
    expect(screen.getByText('Total USDC distributed').closest('article')?.textContent).toContain('2.00 USDC')
    expect(monthRange).toHaveProperty('value', 'month')
  })

  it.each([
    ['retained', true],
    ['changed', false],
  ])('hides tampered cached financial values with a %s provenance marker', (_markerChange, marker) => {
    const tamperedRecord = {
      ...confirmedDistribution(`0x${'8'.repeat(64)}`),
      totalRaw: '9000000',
      recipients: [{ address: alice, amountRaw: '9000000' }],
      verificationStatus: 'unverified' as const,
    }
    const snapshot = Object.assign({
      records: [tamperedRecord],
      coverage: { deploymentBlock: 1n, scannedThroughBlock: 100n },
    }, { recordsPreviouslyReceiptVerified: marker })
    mocks.onchainAnalytics.mockReturnValue({
      state: {
        status: 'loading',
        contextKey: 'mainnet-wallet',
        contracts: [],
        progress: {
          phase: 'scanning',
          fromBlock: 101n,
          toBlock: 120n,
          blocksScanned: 0n,
          totalBlocks: 20n,
          receiptsChecked: 0,
          totalReceipts: 0,
        },
        snapshot,
      },
      retry: vi.fn(),
      refresh: vi.fn(),
      network: {
        name: 'Arc Mainnet',
        analyticsContractAddresses: [activeMainnetContract],
      },
    })

    const { container } = render(<AnalyticsScreen />)

    expect(screen.getByText('Stale cached snapshot · untrusted')).toBeTruthy()
    expect(screen.getByText(/Browser storage cannot authenticate cached analytics/)).toBeTruthy()
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(4)
    expect(screen.queryByText('Total USDC distributed')).toBeNull()
    expect(screen.queryByText('9.00 USDC')).toBeNull()
    expect(screen.queryByRole('group', { name: /Daily Distributions/ })).toBeNull()
    expect(screen.queryByLabelText('Chart month')).toBeNull()
    expect(tamperedRecord.verificationStatus).toBe('unverified')
  })

  it('shows cached receipt revalidation progress separately from event scanning', () => {
    mocks.onchainAnalytics.mockReturnValue({
      state: {
        status: 'loading',
        contextKey: 'mainnet-wallet',
        contracts: [],
        progress: {
          phase: 'revalidating',
          blocksScanned: 0n,
          totalBlocks: 0n,
          receiptsChecked: 25,
          totalReceipts: 100,
        },
      },
      retry: vi.fn(),
      refresh: vi.fn(),
      network: {
        name: 'Arc Mainnet',
        analyticsContractAddresses: [activeMainnetContract],
      },
    })

    render(<AnalyticsScreen />)

    expect(screen.getByRole('heading', { name: 'Payment analytics' })).toBeTruthy()
    expect(screen.getByText('Revalidating cached transactions')).toBeTruthy()
    expect(screen.getByText(/Revalidating cached receipts: 25 of 100/)).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Receipts verified: 25 of 100' }).getAttribute('aria-valuenow')).toBe('25')
    expect(screen.queryByText('Scanning ArcSplit distribution events…')).toBeNull()
    expect(screen.queryByText('Total USDC distributed')).toBeNull()
    expect(screen.getByText('25%')).toBeTruthy()
  })

  it('shows receipt verification progress instead of completed block progress', () => {
    mocks.onchainAnalytics.mockReturnValue({
      state: {
        status: 'loading',
        contextKey: 'mainnet-wallet',
        contracts: [],
        progress: {
          phase: 'verifying',
          blocksScanned: 10_000n,
          totalBlocks: 10_000n,
          receiptsChecked: 25,
          totalReceipts: 100,
        },
      },
      retry: vi.fn(),
      refresh: vi.fn(),
      network: {
        name: 'Arc Mainnet',
        analyticsContractAddresses: [activeMainnetContract],
      },
    })

    const { rerender } = render(<AnalyticsScreen />)

    expect(screen.getByText('Verifying on-chain transactions')).toBeTruthy()
    expect(screen.getByText(/Verifying 25 of 100 transaction receipts/)).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Receipts verified: 25 of 100' }).getAttribute('aria-valuenow')).toBe('25')
    expect(screen.queryByText('100%')).toBeNull()
    expect(screen.queryByText('Total USDC distributed')).toBeNull()

    mocks.onchainAnalytics.mockReturnValue({
      state: {
        status: 'loading',
        contextKey: 'mainnet-wallet',
        contracts: [],
        progress: {
          phase: 'verifying',
          blocksScanned: 10_000n,
          totalBlocks: 10_000n,
          receiptsChecked: 100,
          totalReceipts: 100,
        },
      },
      retry: vi.fn(),
      refresh: vi.fn(),
      network: {
        name: 'Arc Mainnet',
        analyticsContractAddresses: [activeMainnetContract],
      },
    })
    rerender(<AnalyticsScreen />)

    expect(screen.getByText('Confirming on-chain checkpoint')).toBeTruthy()
    expect(screen.getByText(/confirming canonical chain checkpoints/)).toBeTruthy()
    expect(screen.queryByText('Total USDC distributed')).toBeNull()
  })

  it('shows block progress only while scanning and omits unavailable progress', () => {
    mocks.onchainAnalytics.mockReturnValue({
      state: {
        status: 'loading',
        contextKey: 'mainnet-wallet',
        contracts: [],
        progress: {
          phase: 'scanning',
          blocksScanned: 5_000n,
          totalBlocks: 10_000n,
          receiptsChecked: 0,
          totalReceipts: 0,
        },
      },
      retry: vi.fn(),
      refresh: vi.fn(),
      network: {
        name: 'Arc Mainnet',
        analyticsContractAddresses: [activeMainnetContract],
      },
    })

    const view = render(<AnalyticsScreen />)

    expect(screen.getByText('Scanning on-chain activity')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Blocks scanned: 5000 of 10000' }).getAttribute('aria-valuenow')).toBe('50')

    mocks.onchainAnalytics.mockReturnValue({
      state: {
        status: 'loading',
        contextKey: 'mainnet-wallet',
        contracts: [],
        progress: {
          phase: 'discovering',
          blocksScanned: 0n,
          totalBlocks: 0n,
          receiptsChecked: 0,
          totalReceipts: 0,
        },
      },
      retry: vi.fn(),
      refresh: vi.fn(),
      network: {
        name: 'Arc Mainnet',
        analyticsContractAddresses: [activeMainnetContract],
      },
    })
    view.rerender(<AnalyticsScreen />)

    expect(screen.getByText('Preparing on-chain analytics')).toBeTruthy()
    expect(screen.getByText(/Finding the contract deployment block/)).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('does not use unauthenticated cached records for financial totals', () => {
    mocks.onchainAnalytics.mockReturnValue({
      state: {
        status: 'error',
        contextKey: 'mainnet-wallet',
        message: 'historical RPC unavailable',
        snapshot: {
          records: [{
            ...confirmedDistribution(`0x${'2'.repeat(64)}`),
            verificationStatus: 'unverified',
          }],
          coverage: { deploymentBlock: 1n, scannedThroughBlock: 90n },
        },
      },
      retry: vi.fn(),
      refresh: vi.fn(),
      network: {
        name: 'Arc Mainnet',
        analyticsContractAddresses: [activeMainnetContract],
      },
    })

    render(<AnalyticsScreen />)

    expect(screen.getByText(/Browser storage cannot authenticate cached analytics/)).toBeTruthy()
    expect(screen.queryByText('Total USDC distributed')).toBeNull()
    expect(screen.getByRole('heading', {
      name: 'Stale cached snapshot · untrusted',
    })).toBeTruthy()
    expect(screen.queryByRole('group', { name: /Daily Distributions/ })).toBeNull()
  })

  it('labels partial contract analytics clearly instead of as complete', () => {
    mocks.onchainAnalytics.mockReturnValue({
      state: {
        status: 'partial',
        contextKey: 'mainnet-wallet',
        records: [confirmedDistribution(`0x${'9'.repeat(64)}`)],
        deploymentBlock: 1n,
        scannedThroughBlock: 100n,
        warning: 'Verified results from 1 of 2 configured contracts. Still scanning: 0xF13199D9bbf965eE10f41b531Ee4aa660bB54738.',
        progress: {
          phase: 'revalidating',
          blocksScanned: 0n,
          totalBlocks: 0n,
          receiptsChecked: 2,
          totalReceipts: 5,
        },
        contracts: [
          {
            contractAddress: '0x4444444444444444444444444444444444444444',
            status: 'verified',
          },
          {
            contractAddress: '0xF13199D9bbf965eE10f41b531Ee4aa660bB54738',
            status: 'scanning',
            progress: {
              phase: 'revalidating',
              blocksScanned: 0n,
              totalBlocks: 0n,
              receiptsChecked: 2,
              totalReceipts: 5,
            },
          },
        ],
        isScanning: true,
      },
      retry: vi.fn(),
      refresh: vi.fn(),
      network: {
        name: 'Arc Mainnet',
        analyticsContractAddresses: [
          '0x4444444444444444444444444444444444444444',
          '0xF13199D9bbf965eE10f41b531Ee4aa660bB54738',
        ],
      },
    })

    render(<AnalyticsScreen />)

    expect(screen.getByRole('alert').textContent).toContain('Partial verified results')
    expect(screen.getByRole('alert').textContent).toContain('Still scanning')
    expect(screen.getByText('Contract scan status')).toBeTruthy()
    expect(screen.getByText(/Revalidating cached receipts: 2 of 5/)).toBeTruthy()
    expect(screen.getByText('0xF13199D9bbf965eE10f41b531Ee4aa660bB54738')).toBeTruthy()
    expect(screen.getByText(/across 1 of 2 contracts/)).toBeTruthy()
    expect(screen.getByText('Total USDC distributed').closest('article')?.textContent).toContain('1.00 USDC')
  })

  it('shows an empty state when there are no confirmed payments', () => {
    render(<HistoryScreen />)
    expect(screen.getByText('No saved transactions yet')).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Verified daily distributions, last 7 UTC days' })).toBeNull()
  })

  it('renders confirmed payment details and a transaction link', () => {
    addHistoryEntry('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 5042, {
      txHash: `0x${'a'.repeat(64)}`,
      chainId: 5042,
      status: 'success',
      contractAddress: activeMainnetContract,
      mode: 'fixed',
      totalRaw: '1500000',
      recipients: [
        { address: alice, amountRaw: '1000000' },
        { address: bob, amountRaw: '500000' },
      ],
    })

    render(<HistoryScreen />)
    expect(screen.getByText('1.50 USDC')).toBeTruthy()
    fireEvent.click(screen.getByText('Payout details'))
    expect(screen.getByText(alice)).toBeTruthy()
    expect(screen.getByRole('link', { name: /view transaction/i }).getAttribute('href')).toContain(
      `0x${'a'.repeat(64)}`,
    )
    fireEvent.click(screen.getByRole('button', { name: /download pdf/i }))
    return waitFor(() => expect(downloadPaymentReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        networkName: 'Arc Mainnet',
        contractAddress: activeMainnetContract,
      }),
      mocks.publicClient,
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ))
  })

  it('shows only active Mainnet contract history without deleting retired or unidentified records', () => {
    const account = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const mainnet = getArcNetwork(ARC_MAINNET_CHAIN_ID)
    expect(activeMainnetContract).toBe(ARCSPLIT_MAINNET_NEXT_ADDRESS)
    expect(mainnet?.analyticsContractAddresses).toEqual([ARCSPLIT_MAINNET_NEXT_ADDRESS])
    expect(mainnet?.analyticsContractAddresses).not.toContain(ARCSPLIT_MAINNET_LEGACY_ADDRESS)

    addHistoryEntry(account, ARC_MAINNET_CHAIN_ID, {
      txHash: `0x${'a'.repeat(64)}`,
      chainId: ARC_MAINNET_CHAIN_ID,
      contractAddress: activeMainnetContract,
      status: 'success',
      mode: 'fixed',
      totalRaw: '1000000',
      recipients: [
        { address: alice, amountRaw: '500000' },
        { address: bob, amountRaw: '500000' },
      ],
    })
    addHistoryEntry(account, ARC_MAINNET_CHAIN_ID, {
      txHash: `0x${'b'.repeat(64)}`,
      chainId: ARC_MAINNET_CHAIN_ID,
      contractAddress: ARCSPLIT_MAINNET_LEGACY_ADDRESS,
      status: 'success',
      mode: 'fixed',
      totalRaw: '2000000',
      recipients: [{ address: bob, amountRaw: '2000000' }],
    })
    addHistoryEntry(account, ARC_MAINNET_CHAIN_ID, {
      txHash: `0x${'c'.repeat(64)}`,
      chainId: ARC_MAINNET_CHAIN_ID,
      status: 'success',
      mode: 'fixed',
      totalRaw: '3000000',
      recipients: [{ address: alice, amountRaw: '3000000' }],
    })

    render(<HistoryScreen />)

    expect(screen.getByText('1.00 USDC')).toBeTruthy()
    expect(screen.queryByText('2.00 USDC')).toBeNull()
    expect(screen.queryByText('3.00 USDC')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('remain in local storage')
    const storedHistory = getHistory(account, ARC_MAINNET_CHAIN_ID)
    expect(storedHistory).toHaveLength(3)
    expect(storedHistory.some((entry) => entry.contractAddress === ARCSPLIT_MAINNET_LEGACY_ADDRESS)).toBe(true)
    expect(storedHistory.some((entry) => entry.contractAddress === undefined)).toBe(true)
  })

  it('keeps retired Mainnet history stored but excludes it from Analytics local-only results', () => {
    const account = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const retiredTxHash = `0x${'d'.repeat(64)}` as `0x${string}`
    addHistoryEntry(account, ARC_MAINNET_CHAIN_ID, {
      txHash: retiredTxHash,
      chainId: ARC_MAINNET_CHAIN_ID,
      contractAddress: ARCSPLIT_MAINNET_LEGACY_ADDRESS,
      status: 'success',
      mode: 'fixed',
      totalRaw: '2000000',
      recipients: [{ address: bob, amountRaw: '2000000' }],
    })

    render(<AnalyticsScreen />)

    expect(screen.queryByText(retiredTxHash)).toBeNull()
    expect(getHistory(account, ARC_MAINNET_CHAIN_ID)).toHaveLength(1)
  })

  it('keeps Testnet History scoped to the Testnet active contract and wallet network', () => {
    const account = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    addHistoryEntry(account, ARC_MAINNET_CHAIN_ID, {
      txHash: `0x${'a'.repeat(64)}`,
      chainId: ARC_MAINNET_CHAIN_ID,
      contractAddress: activeMainnetContract,
      status: 'success',
      mode: 'fixed',
      totalRaw: '3000000',
      recipients: [
        { address: alice, amountRaw: '1500000' },
        { address: bob, amountRaw: '1500000' },
      ],
    })
    addHistoryEntry(account, ARC_TESTNET_CHAIN_ID, {
      txHash: `0x${'b'.repeat(64)}`,
      chainId: ARC_TESTNET_CHAIN_ID,
      contractAddress: activeTestnetContract,
      status: 'success',
      mode: 'fixed',
      totalRaw: '2000000',
      recipients: [
        { address: alice, amountRaw: '1000000' },
        { address: bob, amountRaw: '1000000' },
      ],
    })
    mocks.account.mockReturnValue({ address: account, chainId: ARC_TESTNET_CHAIN_ID })

    render(<HistoryScreen />)

    expect(screen.getByText('2.00 USDC')).toBeTruthy()
    expect(screen.queryByText('3.00 USDC')).toBeNull()
    expect(getHistory(account, ARC_MAINNET_CHAIN_ID)).toHaveLength(1)
    expect(getHistory(account, ARC_TESTNET_CHAIN_ID)).toHaveLength(1)
  })

  it('does not offer a PDF for a reverted distribution', () => {
    addHistoryEntry('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 5042, {
      txHash: `0x${'b'.repeat(64)}`,
      chainId: 5042,
      status: 'failed',
      contractAddress: activeMainnetContract,
      mode: 'fixed',
      totalRaw: '1500000',
      recipients: [{ address: alice, amountRaw: '1500000' }],
    })

    render(<HistoryScreen />)
    expect(screen.getByText('Reverted · not distributed')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /download pdf/i })).toBeNull()
  })

  it('does not offer receipt download when the saved contract address is missing', async () => {
    addHistoryEntry('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 5042, {
      txHash: `0x${'c'.repeat(64)}`,
      chainId: 5042,
      status: 'success',
      mode: 'fixed',
      totalRaw: '1500000',
      recipients: [{ address: alice, amountRaw: '1500000' }],
    })

    render(<HistoryScreen />)
    expect(screen.queryByRole('button', { name: /download pdf/i })).toBeNull()
    expect(downloadPaymentReceipt).not.toHaveBeenCalled()
  })

  it('shows verified on-chain analytics and separates unmatched local history', () => {
    const confirmedHash = `0x${'d'.repeat(64)}` as `0x${string}`
    const confirmedAt = Date.now()
    const refresh = vi.fn()
    mocks.onchainAnalytics.mockReturnValue({
      state: {
        status: 'ready',
        contextKey: 'mainnet-wallet',
        records: [confirmedDistribution(confirmedHash, confirmedAt)],
        deploymentBlock: 1n,
        scannedThroughBlock: 100n,
      },
      retry: vi.fn(),
      refresh,
      network: {
        name: 'Arc Mainnet',
        analyticsContractAddresses: [activeMainnetContract],
      },
    })
    addHistoryEntry('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 5042, {
      txHash: confirmedHash,
      chainId: 5042,
      status: 'success',
      contractAddress: '0x4444444444444444444444444444444444444444',
      mode: 'fixed',
      totalRaw: '1000000',
      recipients: [{ address: alice, amountRaw: '1000000' }],
    })
    addHistoryEntry('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 5042, {
      txHash: `0x${'e'.repeat(64)}`,
      chainId: 5042,
      status: 'failed',
      mode: 'fixed',
      totalRaw: '9000000',
      recipients: [{ address: bob, amountRaw: '9000000' }],
    })
    addHistoryEntry('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 5042, {
      txHash: `0x${'f'.repeat(64)}`,
      chainId: 5042,
      status: 'success',
      mode: 'fixed',
      totalRaw: '8000000',
      recipients: [{ address: bob, amountRaw: '8000000' }],
    })
    addHistoryEntry('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 5042002, {
      txHash: `0x${'1'.repeat(64)}`,
      chainId: 5042002,
      status: 'success',
      mode: 'fixed',
      totalRaw: '7000000',
      recipients: [{ address: bob, amountRaw: '7000000' }],
    })

    render(<AnalyticsScreen />)

    expect(screen.getByText('Total USDC distributed').closest('article')?.textContent).toContain('1.00 USDC')
    expect(screen.getByText('Reverted transactions').closest('article')?.textContent).toContain('Not indexed')
    expect(screen.getByText('Highest receiving wallet').closest('article')?.textContent).toContain(alice)
    expect(screen.getByText('On-chain distribution overview')).toBeTruthy()
    const dateLabel = formatUtcDayLabel(new Date(confirmedAt).toISOString().slice(0, 10))
    expect(screen.getByRole('link', { name: new RegExp(confirmedHash.slice(0, 10)) })).toBeTruthy()
    expect(screen.getByText(/Arc Mainnet · 1 recipient/)).toBeTruthy()
    expect(getHistory('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 5042)).toHaveLength(2)
    expect(screen.getByText('Local-only saved records')).toBeTruthy()
    expect(screen.getByText(/excluded from analytics/i)).toBeTruthy()
    expect(screen.getByText(/Complete on-chain scan/)).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Verified daily distribution trend, last 7 UTC days' })).toBeNull()
    expect(screen.queryByText('Weekly distributions')).toBeNull()
    expect(screen.getByText('Every UTC calendar day in the selected month; inactive days stay visible.')).toBeTruthy()
    const monthKey = new Date(confirmedAt).toISOString().slice(0, 7)
    const monthLabel = formatUtcMonthLabel(monthKey)
    const monthlyChart = screen.getByRole('group', { name: `Daily Distributions · ${monthLabel} daily chart` })
    expect(within(monthlyChart).getByRole('img', { name: `${dateLabel}: 1.00 USDC verified` })).toBeTruthy()
    expect(monthlyChart.querySelectorAll('[role="img"]')).toHaveLength(
      new Date(Date.UTC(new Date(confirmedAt).getUTCFullYear(), new Date(confirmedAt).getUTCMonth() + 1, 0)).getUTCDate(),
    )
    expect(screen.getByRole('heading', { name: `Daily Distributions · ${monthLabel}` })).toBeTruthy()
    expect(screen.getAllByRole('img', { name: /no distribution activity/ }).length).toBeGreaterThan(0)
    const distributionCharts = monthlyChart.closest('.analytics-distribution-charts')
    expect(distributionCharts?.classList.contains('grid-cols-2')).toBe(false)
    expect(distributionCharts?.classList.contains('w-full')).toBe(true)
    expect(screen.getByRole('option', { name: 'All on-chain history' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /full screen/i })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Full rescan' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('surfaces an incomplete RPC scan with an explicit retry and unverified local history', () => {
    const retry = vi.fn()
    mocks.onchainAnalytics.mockReturnValue({
      state: {
        status: 'error',
        contextKey: 'mainnet-wallet',
        message: 'historical RPC unavailable',
        snapshot: {
          records: [{
            ...confirmedDistribution(`0x${'7'.repeat(64)}`),
            verificationStatus: 'unverified',
          }],
          coverage: { deploymentBlock: 1n, scannedThroughBlock: 90n },
        },
      },
      retry,
      network: {
        name: 'Arc Mainnet',
        analyticsContractAddresses: [activeMainnetContract],
      },
    })
    addHistoryEntry('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 5042, {
      txHash: `0x${'9'.repeat(64)}`,
      chainId: 5042,
      status: 'success',
      mode: 'fixed',
      totalRaw: '1000000',
      recipients: [{ address: alice, amountRaw: '1000000' }],
    })

    render(<AnalyticsScreen />)

    expect(screen.getByText('On-chain analytics could not be completed')).toBeTruthy()
    expect(screen.getByText('Stale cached snapshot · untrusted')).toBeTruthy()
    expect(screen.getByText(/Browser storage cannot authenticate cached analytics/)).toBeTruthy()
    expect(screen.getByText(/latest update failed; cached financial values remain hidden/i)).toBeTruthy()
    expect(screen.getByText('Saved records · not verified')).toBeTruthy()
    expect(screen.getByText(/cannot yet be matched against the chain/i)).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Verified daily distributions, last 7 UTC days' })).toBeNull()
    expect(screen.queryByText('Total USDC distributed')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledOnce()
    expect(screen.getByText(/cached financial values remain hidden/i)).toBeTruthy()
    expect(screen.queryByText('Total USDC distributed')).toBeNull()
  })

  it('shows a clear missing-data state with explicit zero-activity chart periods', () => {
    saveRecipient('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 5042, {
      name: 'Other wallet',
      address: alice,
    })

    render(<AnalyticsScreen />)

    expect(screen.getByText('No confirmed distributions found')).toBeTruthy()
    expect(screen.getByRole('heading', { name: /^Daily Distributions ·/ })).toBeTruthy()
    expect(screen.getAllByRole('img', { name: /no distribution activity/ }).length).toBeGreaterThan(0)
  })

  it('truncates the displayed average payment to one decimal place', () => {
    const record = {
      ...confirmedDistribution(`0x${'6'.repeat(64)}`, Date.now()),
      totalRaw: '2585714',
    }
    mocks.onchainAnalytics.mockReturnValue({
      state: {
        status: 'ready',
        contextKey: 'mainnet-wallet',
        records: [record],
        deploymentBlock: 1n,
        scannedThroughBlock: 100n,
      },
      retry: vi.fn(),
      refresh: vi.fn(),
      network: {
        name: 'Arc Mainnet',
        analyticsContractAddresses: [activeMainnetContract],
      },
    })

    render(<AnalyticsScreen />)

    const average = screen.getByText('Average payment').closest('article')
    expect(average?.textContent).toContain('2.5 USDC')
    expect(average?.textContent).not.toContain('2.585714')
  })

  it('offers verified-history months in reverse order and zero-fills an inactive month', () => {
    const now = new Date()
    const currentMonth = now.toISOString().slice(0, 7)
    const emptyMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
      .toISOString()
      .slice(0, 7)
    const historicalMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1))
      .toISOString()
      .slice(0, 7)
    const earlierEmptyMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1))
      .toISOString()
      .slice(0, 7)
    const earliestSupportedMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 4, 1))
      .toISOString()
      .slice(0, 7)
    const deploymentTimestamp = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 4, 1)
    mocks.onchainAnalytics.mockReturnValue({
      state: {
        status: 'ready',
        contextKey: 'mainnet-wallet',
        records: [confirmedDistribution(
          `0x${'5'.repeat(64)}`,
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 15, 12),
        )],
        deploymentTimestamp,
        deploymentBlock: 1n,
        scannedThroughBlock: 100n,
      },
      retry: vi.fn(),
      refresh: vi.fn(),
      network: {
        name: 'Arc Mainnet',
        analyticsContractAddresses: [activeMainnetContract],
      },
    })

    render(<AnalyticsScreen />)

    const monthSelect = screen.getByRole('combobox', { name: 'Chart month' })
    expect(monthSelect).toHaveProperty('value', currentMonth)
    expect([...monthSelect.querySelectorAll('option')].map((option) => option.value)).toEqual([
      currentMonth,
      emptyMonth,
      historicalMonth,
      earlierEmptyMonth,
      earliestSupportedMonth,
    ])
    fireEvent.change(monthSelect, { target: { value: earlierEmptyMonth } })

    const chart = screen.getByRole('group', {
      name: `Daily Distributions · ${formatUtcMonthLabel(earlierEmptyMonth)} daily chart`,
    })
    const [, monthNumber] = earlierEmptyMonth.split('-')
    const dayCount = new Date(Date.UTC(now.getUTCFullYear(), Number(monthNumber), 0)).getUTCDate()
    expect(chart.querySelectorAll('[role="img"]')).toHaveLength(dayCount)
    expect(within(chart).getAllByRole('img', { name: /no distribution activity, 0.00 USDC/ })).toHaveLength(dayCount)
    expect(chart.closest('article')?.textContent).toContain('0.00 USDC')
  })

  it('keeps chart month selection independent from Overview date filtering', () => {
    const now = new Date()
    const currentMonth = now.toISOString().slice(0, 7)
    const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
      .toISOString()
      .slice(0, 7)
    const inRangeAt = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59)
    const secondInRangeAt = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12)
    const outOfRangeAt = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 2, 12)
    const records = [
      confirmedDistribution(`0x${'2'.repeat(64)}`, inRangeAt),
      confirmedDistribution(`0x${'3'.repeat(64)}`, secondInRangeAt),
      confirmedDistribution(`0x${'4'.repeat(64)}`, outOfRangeAt),
    ]
    mocks.onchainAnalytics.mockReturnValue({
      state: {
        status: 'ready',
        contextKey: 'mainnet-wallet',
        records,
        deploymentBlock: 1n,
        scannedThroughBlock: 100n,
      },
      retry: vi.fn(),
      refresh: vi.fn(),
      rescan: vi.fn(),
      network: {
        name: 'Arc Mainnet',
        analyticsContractAddresses: [activeMainnetContract],
      },
    })

    render(<AnalyticsScreen />)

    const total = screen.getByText('Total USDC distributed').closest('article')
    const overviewRange = screen.getByRole('combobox', { name: 'Date range' })
    const chartMonth = screen.getByRole('combobox', { name: 'Chart month' })
    expect(chartMonth).toHaveProperty('value', currentMonth)
    let chart = screen.getByRole('group', {
      name: `Daily Distributions · ${formatUtcMonthLabel(currentMonth)} daily chart`,
    })
    expect(total?.textContent).toContain('2.00 USDC')
    expect(chart.closest('article')?.textContent).toContain('2.00 USDC')

    fireEvent.change(overviewRange, { target: { value: 'all' } })
    expect(total?.textContent).toContain('3.00 USDC')
    expect(chart.closest('article')?.textContent).toContain('2.00 USDC')

    fireEvent.change(overviewRange, { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText('From'), {
      target: { value: new Date(inRangeAt).toISOString().slice(0, 10) },
    })
    fireEvent.change(screen.getByLabelText('Through'), {
      target: { value: new Date(secondInRangeAt).toISOString().slice(0, 10) },
    })

    expect(total?.textContent).toContain('2.00 USDC')
    expect(screen.getByText('Confirmed distributions').closest('article')?.textContent).toContain('2')
    expect(chart.closest('article')?.textContent).toContain('2.00 USDC')

    fireEvent.change(chartMonth, { target: { value: previousMonth } })
    chart = screen.getByRole('group', {
      name: `Daily Distributions · ${formatUtcMonthLabel(previousMonth)} daily chart`,
    })
    expect(within(chart).getByRole('img', {
      name: `${formatUtcDayLabel(new Date(inRangeAt).toISOString().slice(0, 10))}: 1.00 USDC verified`,
    })).toBeTruthy()
    expect(chart.closest('article')?.textContent).toContain('1.00 USDC')
    expect(total?.textContent).toContain('2.00 USDC')
    expect(overviewRange).toHaveProperty('value', 'custom')
  })

  it('does not briefly expose the previous wallet history after an account or network switch', () => {
    const hash = `0x${'2'.repeat(64)}` as `0x${string}`
    mocks.onchainAnalytics.mockImplementation((address: string, chainId: number) => ({
      state: {
        status: 'ready',
        contextKey: `${address}:${chainId}`,
        records: address === '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' && chainId === 5042
          ? [confirmedDistribution(hash)]
          : [],
        deploymentBlock: 1n,
        scannedThroughBlock: 100n,
      },
      retry: vi.fn(),
      network: {
        name: chainId === 5042 ? 'Arc Mainnet' : 'Arc Testnet',
        analyticsContractAddresses: [
          chainId === 5042
            ? activeMainnetContract
            : '0x0c4DC391c39641B5DEa9304454B99B37c9FFFb35',
        ],
      },
    }))
    addHistoryEntry('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 5042, {
      txHash: hash,
      chainId: 5042,
      status: 'success',
      mode: 'fixed',
      totalRaw: '1000000',
      recipients: [{ address: alice, amountRaw: '1000000' }],
    })
    const view = render(<AnalyticsScreen />)
    expect(screen.getByText('Total USDC distributed').closest('article')?.textContent).toContain('1.00 USDC')

    mocks.account.mockReturnValue({
      address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      chainId: 5042002,
    })
    view.rerender(<AnalyticsScreen />)

    expect(screen.getByText('No confirmed distributions found')).toBeTruthy()
    expect(screen.queryByText('1.00 USDC')).toBeNull()
  })
})
