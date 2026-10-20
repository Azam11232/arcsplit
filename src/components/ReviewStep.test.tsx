import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WaitForTransactionReceiptTimeoutError } from 'viem'
import type { Hash } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewStep } from './ReviewStep'

const mocks = vi.hoisted(() => ({
  approveHash: `0x${'a'.repeat(64)}` as Hash,
  distributeHash: `0x${'b'.repeat(64)}` as Hash,
  account: vi.fn(() => ({ chainId: 5042 })),
  writeContract: vi.fn<(
    request: { functionName: string },
    callbacks: { onSuccess?: (hash: `0x${string}`) => void },
  ) => void>(),
  approveCalls: [] as unknown[],
  distributeCalls: [] as unknown[],
  approval: {
    data: undefined as { status: 'success' | 'reverted' } | undefined,
    error: null as Error | null,
    fetching: false,
    refetch: vi.fn(),
  },
  distribution: {
    data: undefined as { status: 'success' | 'reverted' } | undefined,
    error: null as Error | null,
    fetching: false,
    refetch: vi.fn(),
  },
  refetchAllowance: vi.fn(),
  refetchBalance: vi.fn(),
}))

vi.mock('wagmi', () => ({
  useAccount: mocks.account,
  useSwitchChain: () => ({ switchChain: vi.fn(), isPending: false }),
  useWriteContract: () => ({ writeContract: mocks.writeContract }),
  useWaitForTransactionReceipt: ({ hash }: { hash?: `0x${string}` }) => {
    const receiptState = hash === mocks.approveHash
      ? mocks.approval
      : hash === mocks.distributeHash
        ? mocks.distribution
        : undefined

    return {
      data: receiptState?.data,
      error: receiptState?.error ?? null,
      isError: !!receiptState?.error,
      isFetching: receiptState?.fetching ?? false,
      isLoading: !!hash && !receiptState?.data && !receiptState?.error,
      refetch: receiptState?.refetch ?? vi.fn(),
    }
  },
}))

vi.mock('@/hooks/useUsdcAllowance', () => ({
  useUsdcAllowance: () => ({ raw: 0n, refetch: mocks.refetchAllowance }),
}))

vi.mock('@/hooks/useUsdcBalance', () => ({
  useUsdcBalance: () => ({ raw: 2_000_000n, refetch: mocks.refetchBalance }),
}))

vi.mock('@web3icons/react', () => ({
  TokenUSDC: () => <span aria-hidden="true">USDC</span>,
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

const recipients = [
  { id: 'alice', address: '0x1111111111111111111111111111111111111111', sharesBps: 5000 },
  { id: 'bob', address: '0x2222222222222222222222222222222222222222', sharesBps: 5000 },
]

function renderReviewStep() {
  return render(
    <ReviewStep
      amountRaw={2_000_000n}
      recipients={recipients}
      onBack={vi.fn()}
      onReset={vi.fn()}
    />,
  )
}

async function submitApprovalAndDistribution() {
  const view = renderReviewStep()

  fireEvent.click(screen.getByRole('button', { name: /approve usdc/i }))
  await waitFor(() => expect(mocks.approveCalls).toHaveLength(1))

  mocks.approval.data = { status: 'success' }
  view.rerender(
    <ReviewStep amountRaw={2_000_000n} recipients={recipients} onBack={vi.fn()} onReset={vi.fn()} />,
  )

  fireEvent.click(await screen.findByRole('button', { name: /approved — continue/i }))
  fireEvent.click(screen.getByRole('button', { name: /distribute now/i }))
  await waitFor(() => expect(mocks.distributeCalls).toHaveLength(1))

  return view
}

beforeEach(() => {
  mocks.approveCalls.length = 0
  mocks.distributeCalls.length = 0
  mocks.approval.data = undefined
  mocks.approval.error = null
  mocks.approval.fetching = false
  mocks.approval.refetch.mockReset()
  mocks.distribution.data = undefined
  mocks.distribution.error = null
  mocks.distribution.fetching = false
  mocks.distribution.refetch.mockReset()
  mocks.refetchAllowance.mockReset()
  mocks.refetchBalance.mockReset()
  mocks.account.mockReturnValue({ chainId: 5042 })
  mocks.writeContract.mockImplementation((request, callbacks) => {
    if (request.functionName === 'approve') {
      mocks.approveCalls.push(request)
      callbacks.onSuccess?.(mocks.approveHash)
    } else {
      mocks.distributeCalls.push(request)
      callbacks.onSuccess?.(mocks.distributeHash)
    }
  })
})

afterEach(() => {
  cleanup()
})

describe('ReviewStep receipt handling', () => {
  it('shows Payment Sent only after a successful distribution receipt', async () => {
    const view = await submitApprovalAndDistribution()

    expect(screen.queryByText('Payment Sent')).toBeNull()

    mocks.distribution.data = { status: 'success' }
    view.rerender(
      <ReviewStep amountRaw={2_000_000n} recipients={recipients} onBack={vi.fn()} onReset={vi.fn()} />,
    )

    expect(await screen.findByText('Payment Sent')).toBeTruthy()
  })

  it('shows a failure state and never reports success for a reverted distribution', async () => {
    const view = await submitApprovalAndDistribution()

    mocks.distribution.data = { status: 'reverted' }
    view.rerender(
      <ReviewStep amountRaw={2_000_000n} recipients={recipients} onBack={vi.fn()} onReset={vi.fn()} />,
    )

    expect(await screen.findByText('The distribution transaction reverted. No payment was sent.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /retry distribution/i })).toBeTruthy()
    expect(screen.queryByText('Payment Sent')).toBeNull()
  })

  it.each([
    ['receipt retrieval error', new Error('RPC unavailable')],
    ['receipt timeout', new WaitForTransactionReceiptTimeoutError({ hash: mocks.distributeHash })],
  ])('shows an unknown outcome for a distribution %s', async (_label, receiptError) => {
    const view = await submitApprovalAndDistribution()

    mocks.distribution.error = receiptError
    view.rerender(
      <ReviewStep amountRaw={2_000_000n} recipients={recipients} onBack={vi.fn()} onReset={vi.fn()} />,
    )

    expect(await screen.findByText(/transaction outcome is unknown/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /retry distribution status check/i })).toBeTruthy()
    expect(screen.queryByText('Payment Sent')).toBeNull()
  })

  it('retries receipt retrieval without submitting another distribution', async () => {
    const view = await submitApprovalAndDistribution()

    mocks.distribution.error = new Error('RPC unavailable')
    view.rerender(
      <ReviewStep amountRaw={2_000_000n} recipients={recipients} onBack={vi.fn()} onReset={vi.fn()} />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /retry distribution status check/i }))

    expect(mocks.distribution.refetch).toHaveBeenCalledTimes(1)
    expect(mocks.distributeCalls).toHaveLength(1)
    expect(screen.queryByText('Payment Sent')).toBeNull()
  })

  it('refreshes balance only once for a confirmed distribution hash across rerenders', async () => {
    const view = await submitApprovalAndDistribution()

    mocks.distribution.data = { status: 'success' }
    view.rerender(
      <ReviewStep amountRaw={2_000_000n} recipients={recipients} onBack={vi.fn()} onReset={vi.fn()} />,
    )
    expect(await screen.findByText('Payment Sent')).toBeTruthy()
    await waitFor(() => expect(mocks.refetchBalance).toHaveBeenCalledTimes(1))

    view.rerender(
      <ReviewStep amountRaw={2_000_000n} recipients={recipients} onBack={vi.fn()} onReset={vi.fn()} />,
    )

    expect(mocks.refetchBalance).toHaveBeenCalledTimes(1)
  })

  it('allows distribution only after approval has a successful receipt', async () => {
    const view = renderReviewStep()

    fireEvent.click(screen.getByRole('button', { name: /approve usdc/i }))
    await waitFor(() => expect(mocks.approveCalls).toHaveLength(1))
    expect(screen.queryByRole('button', { name: /approved — continue/i })).toBeNull()
    expect(mocks.distributeCalls).toHaveLength(0)

    mocks.approval.data = { status: 'success' }
    view.rerender(
      <ReviewStep amountRaw={2_000_000n} recipients={recipients} onBack={vi.fn()} onReset={vi.fn()} />,
    )

    expect(await screen.findByRole('button', { name: /approved — continue/i })).toBeTruthy()
    expect(mocks.distributeCalls).toHaveLength(0)
  })

  it('shows a retryable failure for a reverted approval receipt', async () => {
    const view = renderReviewStep()

    fireEvent.click(screen.getByRole('button', { name: /approve usdc/i }))
    await waitFor(() => expect(mocks.approveCalls).toHaveLength(1))

    mocks.approval.data = { status: 'reverted' }
    view.rerender(
      <ReviewStep amountRaw={2_000_000n} recipients={recipients} onBack={vi.fn()} onReset={vi.fn()} />,
    )

    expect(await screen.findByText('The approval transaction reverted. No approval was confirmed.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /retry approval/i })).toBeTruthy()
    expect(mocks.distributeCalls).toHaveLength(0)
  })

  it('retries an unknown approval status without resubmitting approval', async () => {
    const view = renderReviewStep()

    fireEvent.click(screen.getByRole('button', { name: /approve usdc/i }))
    await waitFor(() => expect(mocks.approveCalls).toHaveLength(1))

    mocks.approval.error = new Error('RPC unavailable')
    view.rerender(
      <ReviewStep amountRaw={2_000_000n} recipients={recipients} onBack={vi.fn()} onReset={vi.fn()} />,
    )

    expect(await screen.findByText(/transaction outcome is unknown/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /retry approval status check/i }))

    expect(mocks.approval.refetch).toHaveBeenCalledTimes(1)
    expect(mocks.approveCalls).toHaveLength(1)
    expect(mocks.distributeCalls).toHaveLength(0)
  })
})
