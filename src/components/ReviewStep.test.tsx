import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WaitForTransactionReceiptTimeoutError } from 'viem'
import type { Hash } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewStep } from './ReviewStep'
import { getHistory } from '@/utils/splitStorage'
import { savePendingTransaction } from '@/utils/pendingTransaction'

const mocks = vi.hoisted(() => {
  const approveHash: Hash = `0x${'a'.repeat(64)}`
  const distributeHash: Hash = `0x${'b'.repeat(64)}`
  return {
    approveHash,
    distributeHash,
    mainnetTargetAddress: '0xB7Ee9d819AA626F3ABA56ab3948bC56fa62f0E7E',
    account: vi.fn(() => ({
      address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}` | undefined,
      chainId: 5042,
    })),
    writeContract: vi.fn<(
      request: { functionName: string },
      callbacks: {
        onSuccess?: (hash: `0x${string}`) => void
        onError?: (error: Error) => void
      },
    ) => void>(),
    approveCalls: [] as unknown[],
    distributeCalls: [] as unknown[],
    simulationCalls: [] as unknown[],
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
    allowance: {
      raw: 0n,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null as Error | null,
    },
    balance: {
      raw: 2_000_000n,
      isLoading: false,
      isError: false,
      error: null as Error | null,
    },
    simulation: {
      data: { request: { functionName: 'distributeFixedAmounts' } },
      error: null as Error | null,
      isFetching: false,
    },
    refetchAllowance: vi.fn(),
    refetchBalance: vi.fn(),
  }
})

vi.mock('@/utils/arcsplit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/arcsplit')>()
  return {
    ...actual,
    getArcNetwork: (chainId: number) => {
      const network = actual.getArcNetwork(chainId)
      return chainId === 5042 && network
        ? { ...network, contractAddress: mocks.mainnetTargetAddress as `0x${string}` }
        : network
    },
  }
})

vi.mock('wagmi', () => ({
  useAccount: mocks.account,
  useSimulateContract: (request: {
    address?: string
    args: [string[], bigint[]]
    functionName: string
  }) => {
    mocks.simulationCalls.push(request)
    return {
      ...mocks.simulation,
      data: mocks.simulation.error
        ? undefined
        : { request: { address: request.address, functionName: request.functionName, args: request.args } },
    }
  },
  useSwitchChain: () => ({ switchChain: vi.fn(), isPending: false }),
  useWriteContract: () => ({ mutate: mocks.writeContract, isPending: false }),
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
  useUsdcAllowance: () => ({ ...mocks.allowance, refetch: mocks.refetchAllowance }),
}))

vi.mock('@/hooks/useUsdcBalance', () => ({
  useUsdcBalance: () => ({ ...mocks.balance, refetch: mocks.refetchBalance }),
}))

vi.mock('@web3icons/react', () => ({
  TokenUSDC: () => <span aria-hidden="true">USDC</span>,
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

const recipients = [
  { id: 'alice', address: '0x1111111111111111111111111111111111111111', amountRaw: 1_250_000n },
  { id: 'bob', address: '0x2222222222222222222222222222222222222222', amountRaw: 750_000n },
]

function renderReviewStep(onDistributionConfirmed?: () => void) {
  return render(
    <ReviewStep
      amountRaw={2_000_000n}
      recipients={recipients}
      onBack={vi.fn()}
      onReset={vi.fn()}
      onDistributionConfirmed={onDistributionConfirmed}
    />,
  )
}

async function submitApprovalAndDistribution(onDistributionConfirmed?: () => void) {
  const view = renderReviewStep(onDistributionConfirmed)

  fireEvent.click(screen.getByRole('button', { name: /approve usdc/i }))
  await waitFor(() => expect(mocks.approveCalls).toHaveLength(1))
  expect(mocks.approveCalls[0]).toMatchObject({
    functionName: 'approve',
    args: [
      '0xB7Ee9d819AA626F3ABA56ab3948bC56fa62f0E7E',
      2_000_000n,
    ],
  })

  mocks.approval.data = { status: 'success' }
  mocks.allowance.raw = 2_000_000n
  view.rerender(
    <ReviewStep
      amountRaw={2_000_000n}
      recipients={recipients}
      onBack={vi.fn()}
      onReset={vi.fn()}
      onDistributionConfirmed={onDistributionConfirmed}
    />,
  )

  fireEvent.click(await screen.findByRole('button', { name: /distribute now/i }))
  await waitFor(() => expect(mocks.distributeCalls).toHaveLength(1))

  return view
}

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
  mocks.approveCalls.length = 0
  mocks.distributeCalls.length = 0
  mocks.simulationCalls.length = 0
  mocks.mainnetTargetAddress = '0xB7Ee9d819AA626F3ABA56ab3948bC56fa62f0E7E'
  mocks.approval.data = undefined
  mocks.approval.error = null
  mocks.approval.fetching = false
  mocks.approval.refetch.mockReset()
  mocks.distribution.data = undefined
  mocks.distribution.error = null
  mocks.distribution.fetching = false
  mocks.distribution.refetch.mockReset()
  mocks.refetchAllowance.mockReset()
  mocks.refetchAllowance.mockResolvedValue({ isError: false, error: null })
  mocks.refetchBalance.mockReset()
  mocks.allowance.raw = 0n
  mocks.allowance.isLoading = false
  mocks.allowance.isFetching = false
  mocks.allowance.isError = false
  mocks.allowance.error = null
  mocks.balance.raw = 2_000_000n
  mocks.balance.isLoading = false
  mocks.balance.isError = false
  mocks.balance.error = null
  mocks.simulation.data = { request: { functionName: 'distributeFixedAmounts' } }
  mocks.simulation.error = null
  mocks.simulation.isFetching = false
  mocks.account.mockReturnValue({
    address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    chainId: 5042,
  })
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
  it('calls distributeFixedAmounts with exact recipient amounts', async () => {
    mocks.account.mockReturnValue({
      address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      chainId: 5042,
    })
    const view = render(
      <ReviewStep
        amountRaw={2_000_000n}
        recipients={recipients}
        onBack={vi.fn()}
        onReset={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /approve usdc/i }))
    await waitFor(() => expect(mocks.approveCalls).toHaveLength(1))

    mocks.approval.data = { status: 'success' }
    mocks.allowance.raw = 2_000_000n
    view.rerender(
      <ReviewStep amountRaw={2_000_000n} recipients={recipients} onBack={vi.fn()} onReset={vi.fn()} />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /distribute now/i }))

    await waitFor(() => expect(mocks.distributeCalls).toHaveLength(1))
    expect(mocks.distributeCalls[0]).toMatchObject({
      functionName: 'distributeFixedAmounts',
      args: [
        [recipients[0].address, recipients[1].address],
        [1_250_000n, 750_000n],
      ],
    })
    expect(mocks.approveCalls[0]).toMatchObject({
      functionName: 'approve',
      args: ['0xB7Ee9d819AA626F3ABA56ab3948bC56fa62f0E7E', 2_000_000n],
    })
  })

  it('uses the staged Mainnet target for allowance approval and distribution requests', async () => {
    const newContract = '0xF13199D9bbf965eE10f41b531Ee4aa660bB54738'
    mocks.mainnetTargetAddress = newContract
    const view = renderReviewStep()

    expect(mocks.simulationCalls[mocks.simulationCalls.length - 1]).toMatchObject({ address: newContract })
    fireEvent.click(screen.getByRole('button', { name: /approve usdc/i }))
    await waitFor(() => expect(mocks.approveCalls).toHaveLength(1))
    expect(mocks.approveCalls[0]).toMatchObject({
      functionName: 'approve',
      args: [newContract, 2_000_000n],
    })

    mocks.approval.data = { status: 'success' }
    mocks.allowance.raw = 2_000_000n
    view.rerender(
      <ReviewStep amountRaw={2_000_000n} recipients={recipients} onBack={vi.fn()} onReset={vi.fn()} />,
    )
    fireEvent.click(await screen.findByRole('button', { name: /distribute now/i }))

    await waitFor(() => expect(mocks.distributeCalls).toHaveLength(1))
    expect(mocks.distributeCalls[0]).toMatchObject({
      address: newContract,
      functionName: 'distributeFixedAmounts',
    })
  })

  it('blocks fixed distribution when the fixed total does not match the split amount', () => {
    render(
      <ReviewStep
        amountRaw={2_000_000n}
        recipients={[
          { ...recipients[0], amountRaw: 1_000_000n },
          { ...recipients[1], amountRaw: 500_000n },
        ]}
        onBack={vi.fn()}
        onReset={vi.fn()}
      />,
    )

    expect(screen.getByText(/Allocated amounts must match the total amount/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /approve usdc/i }))
    expect(mocks.approveCalls).toHaveLength(0)
    expect(mocks.distributeCalls).toHaveLength(0)
  })

  it('resets pending transaction state when the wallet account changes', async () => {
    const view = renderReviewStep()

    fireEvent.click(screen.getByRole('button', { name: /approve usdc/i }))
    await waitFor(() => expect(mocks.approveCalls).toHaveLength(1))

    mocks.account.mockReturnValue({
      address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      chainId: 5042,
    })
    view.rerender(
      <ReviewStep amountRaw={2_000_000n} recipients={recipients} onBack={vi.fn()} onReset={vi.fn()} />,
    )

    expect(await screen.findByText(/Wallet account or network changed/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /distribute now/i })).toBeNull()
  })

  it('shows Payment Sent only after a successful distribution receipt', async () => {
    const onDistributionConfirmed = vi.fn()
    const view = await submitApprovalAndDistribution(onDistributionConfirmed)

    expect(screen.queryByText('Payment Sent')).toBeNull()
    expect(onDistributionConfirmed).not.toHaveBeenCalled()

    mocks.distribution.data = { status: 'success' }
    view.rerender(
      <ReviewStep
        amountRaw={2_000_000n}
        recipients={recipients}
        onBack={vi.fn()}
        onReset={vi.fn()}
        onDistributionConfirmed={onDistributionConfirmed}
      />,
    )

    expect(await screen.findByText('Payment Sent')).toBeTruthy()
    expect(onDistributionConfirmed).toHaveBeenCalledTimes(1)
    expect(getHistory('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 5042)[0]).toMatchObject({
      status: 'success',
      contractAddress: '0xB7Ee9d819AA626F3ABA56ab3948bC56fa62f0E7E',
      mode: 'fixed',
      totalRaw: '2000000',
      recipients: [
        { address: recipients[0].address, amountRaw: '1250000' },
        { address: recipients[1].address, amountRaw: '750000' },
      ],
    })

    view.rerender(
      <ReviewStep
        amountRaw={2_000_000n}
        recipients={recipients}
        onBack={vi.fn()}
        onReset={vi.fn()}
        onDistributionConfirmed={onDistributionConfirmed}
      />,
    )
    expect(onDistributionConfirmed).toHaveBeenCalledTimes(1)
  })

  it('shows a failure state and never reports success for a reverted distribution', async () => {
    const onDistributionConfirmed = vi.fn()
    const view = await submitApprovalAndDistribution(onDistributionConfirmed)

    mocks.distribution.data = { status: 'reverted' }
    view.rerender(
      <ReviewStep
        amountRaw={2_000_000n}
        recipients={recipients}
        onBack={vi.fn()}
        onReset={vi.fn()}
        onDistributionConfirmed={onDistributionConfirmed}
      />,
    )

    expect(await screen.findByText('The distribution transaction reverted. No payment was recorded as successful.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /distribute now/i })).toBeTruthy()
    expect(screen.queryByText('Payment Sent')).toBeNull()
    expect(onDistributionConfirmed).not.toHaveBeenCalled()
    expect(getHistory('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 5042)[0]).toMatchObject({
      status: 'failed',
      contractAddress: '0xB7Ee9d819AA626F3ABA56ab3948bC56fa62f0E7E',
    })
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
    expect(getHistory('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 5042)).toHaveLength(0)
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

  it('enables distribution from the on-chain allowance after approval confirms', async () => {
    const view = renderReviewStep()

    fireEvent.click(screen.getByRole('button', { name: /approve usdc/i }))
    await waitFor(() => expect(mocks.approveCalls).toHaveLength(1))
    expect(screen.queryByRole('button', { name: /distribute now/i })).toBeNull()
    expect(mocks.distributeCalls).toHaveLength(0)

    mocks.approval.data = { status: 'success' }
    mocks.allowance.raw = 2_000_000n
    view.rerender(
      <ReviewStep amountRaw={2_000_000n} recipients={recipients} onBack={vi.fn()} onReset={vi.fn()} />,
    )

    expect(await screen.findByRole('button', { name: /distribute now/i })).toBeTruthy()
    expect(mocks.distributeCalls).toHaveLength(0)
  })

  it('clears a reverted approval and allows a fresh approval', async () => {
    const view = renderReviewStep()

    fireEvent.click(screen.getByRole('button', { name: /approve usdc/i }))
    await waitFor(() => expect(mocks.approveCalls).toHaveLength(1))

    mocks.approval.data = { status: 'reverted' }
    view.rerender(
      <ReviewStep amountRaw={2_000_000n} recipients={recipients} onBack={vi.fn()} onReset={vi.fn()} />,
    )

    expect(await screen.findByText('The approval transaction reverted. No approval was confirmed.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /approve usdc/i })).toBeTruthy()
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

  it('uses the current allowance after refresh and prevents duplicate distribution submissions', async () => {
    mocks.allowance.raw = 2_000_000n
    renderReviewStep()

    expect(screen.queryByRole('button', { name: /approve usdc/i })).toBeNull()
    const distributeButton = await screen.findByRole('button', { name: /distribute now/i })
    fireEvent.click(distributeButton)
    fireEvent.click(distributeButton)

    await waitFor(() => expect(mocks.distributeCalls).toHaveLength(1))
    const simulationCall = mocks.simulationCalls[mocks.simulationCalls.length - 1] as {
      args: [string[], bigint[]]
    }
    expect(simulationCall.args).toEqual([
      [recipients[0].address, recipients[1].address],
      [1_250_000n, 750_000n],
    ])
  })

  it('blocks distribution when the read-only simulation fails and shows its actual reason', async () => {
    mocks.allowance.raw = 2_000_000n
    mocks.simulation.error = new Error('execution reverted: function selector not supported')
    renderReviewStep()

    expect(await screen.findByText(/Distribution preflight failed: execution reverted: function selector not supported/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /distribute now/i }).hasAttribute('disabled')).toBe(true)
    expect(mocks.distributeCalls).toHaveLength(0)
  })

  it('recovers a pending distribution after remount and records history only after success', async () => {
    savePendingTransaction('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 5042, {
      kind: 'distribution',
      txHash: mocks.distributeHash,
      amountRaw: '2000000',
      contractAddress: '0xB7Ee9d819AA626F3ABA56ab3948bC56fa62f0E7E',
      recipients: recipients.map((recipient) => ({
        address: recipient.address,
        amountRaw: recipient.amountRaw.toString(),
      })),
    })
    mocks.distribution.data = undefined
    const view = renderReviewStep()

    expect(await screen.findByText('Distributing…')).toBeTruthy()
    expect(getHistory('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 5042)).toHaveLength(0)
    expect(mocks.distributeCalls).toHaveLength(0)

    mocks.distribution.data = { status: 'success' }
    view.rerender(
      <ReviewStep amountRaw={2_000_000n} recipients={recipients} onBack={vi.fn()} onReset={vi.fn()} />,
    )

    expect(await screen.findByText('Payment Sent')).toBeTruthy()
    expect(getHistory('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 5042)).toHaveLength(1)
  })

  it('recovers a pending approval without submitting a duplicate and refreshes allowance on confirmation', async () => {
    savePendingTransaction('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 5042, {
      kind: 'approval',
      txHash: mocks.approveHash,
      amountRaw: '2000000',
      contractAddress: '0xB7Ee9d819AA626F3ABA56ab3948bC56fa62f0E7E',
      recipients: recipients.map((recipient) => ({
        address: recipient.address,
        amountRaw: recipient.amountRaw.toString(),
      })),
    })
    const view = renderReviewStep()
    expect(await screen.findByText('Confirming approval…')).toBeTruthy()
    expect(mocks.approveCalls).toHaveLength(0)

    mocks.approval.data = { status: 'success' }
    mocks.allowance.raw = 2_000_000n
    view.rerender(
      <ReviewStep amountRaw={2_000_000n} recipients={recipients} onBack={vi.fn()} onReset={vi.fn()} />,
    )

    expect(await screen.findByRole('button', { name: /distribute now/i })).toBeTruthy()
    expect(mocks.refetchAllowance).toHaveBeenCalledTimes(1)
    expect(mocks.approveCalls).toHaveLength(0)
  })

  it('does not recover an approval submitted to a different contract spender', async () => {
    mocks.mainnetTargetAddress = '0xF13199D9bbf965eE10f41b531Ee4aa660bB54738'
    savePendingTransaction('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 5042, {
      kind: 'approval',
      txHash: mocks.approveHash,
      amountRaw: '2000000',
      contractAddress: '0xB7Ee9d819AA626F3ABA56ab3948bC56fa62f0E7E',
      recipients: recipients.map((recipient) => ({
        address: recipient.address,
        amountRaw: recipient.amountRaw.toString(),
      })),
    })

    renderReviewStep()

    expect(await screen.findByRole('button', { name: /approve usdc/i })).toBeTruthy()
    expect(screen.queryByText('Confirming approval…')).toBeNull()
    expect(mocks.approveCalls).toHaveLength(0)
  })

  it('surfaces a distribution submission rejection without recording history', async () => {
    mocks.allowance.raw = 2_000_000n
    mocks.writeContract.mockImplementation((request, callbacks) => {
      if (request.functionName === 'approve') mocks.approveCalls.push(request)
      else {
        mocks.distributeCalls.push(request)
        callbacks.onError?.(new Error('User rejected the request'))
      }
    })
    renderReviewStep()

    fireEvent.click(await screen.findByRole('button', { name: /distribute now/i }))

    expect(await screen.findByText('Transaction cancelled.')).toBeTruthy()
    expect(mocks.distributeCalls).toHaveLength(1)
    expect(getHistory('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 5042)).toHaveLength(0)
  })
})
