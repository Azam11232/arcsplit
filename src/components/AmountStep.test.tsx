import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AmountStep } from './AmountStep'

const mocks = vi.hoisted(() => ({
  account: vi.fn<() => {
    chainId: number | undefined
    isConnected: boolean
    address: string | undefined
  }>(() => ({ chainId: undefined, isConnected: false, address: undefined })),
  getArcNetwork: vi.fn(),
  switchChain: vi.fn(),
  network: undefined as {
    chainId: number
    name: string
    contractAddress: `0x${string}`
  } | undefined,
}))

vi.mock('wagmi', () => ({
  useAccount: mocks.account,
  useSwitchChain: () => ({ switchChain: mocks.switchChain }),
}))

vi.mock('connectkit', () => ({
  ConnectKitButton: {
    Custom: ({ children }: { children: (props: { show: () => void }) => ReactNode }) =>
      children({ show: vi.fn() }),
  },
}))

vi.mock('@web3icons/react', () => ({
  TokenUSDC: () => <span aria-hidden="true">USDC</span>,
}))

vi.mock('@/hooks/useUsdcBalance', () => ({
  useUsdcBalance: () => ({ raw: 1_000_000_000n, formatted: '1,000.00', isLoading: false }),
}))

vi.mock('@/utils/arcsplit', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/utils/arcsplit')>(),
  getArcNetwork: mocks.getArcNetwork,
}))

function renderAmountStep() {
  const onNext = vi.fn()
  const view = render(
    <AmountStep initialAmountRaw={0n} onNext={onNext} />,
  )
  return { ...view, onNext }
}

beforeEach(() => {
  mocks.account.mockReturnValue({ chainId: undefined, isConnected: false, address: undefined })
  mocks.network = undefined
  mocks.getArcNetwork.mockImplementation(() => mocks.network)
  mocks.switchChain.mockReset()
})

afterEach(cleanup)

describe('AmountStep', () => {
  it('keeps library sections off the Send screen', () => {
    renderAmountStep()

    expect(screen.queryByRole('button', { name: /saved/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /templates/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /history/i })).toBeNull()
    expect((screen.getByRole('textbox', { name: 'USDC amount to split' }) as HTMLInputElement).value).toBe('')
  })

  it('does not show the notice when the wallet is disconnected', () => {
    renderAmountStep()

    expect(screen.queryByText('ArcSplit contract address is not configured for this network.')).toBeNull()
  })

  it('does not show the notice for configured Arc Mainnet', () => {
    mocks.account.mockReturnValue({
      chainId: 5042,
      isConnected: true,
      address: '0x1111111111111111111111111111111111111111',
    })
    mocks.network = {
      chainId: 5042,
      name: 'Arc Mainnet',
      contractAddress: '0x2222222222222222222222222222222222222222',
    }

    renderAmountStep()

    expect(screen.queryByText('ArcSplit contract address is not configured for this network.')).toBeNull()
  })

  it('offers a user-triggered switch to Mainnet on Arc Testnet while preserving testing access', () => {
    mocks.account.mockReturnValue({
      chainId: 5042002,
      isConnected: true,
      address: '0x1111111111111111111111111111111111111111',
    })
    mocks.network = {
      chainId: 5042002,
      name: 'Arc Testnet',
      contractAddress: '0xd90b75d07a2b592b0a01f0ac63d522f54ffd1ef2',
    }

    renderAmountStep()

    expect(screen.getByText(/Arc Testnet is for local development and testing/)).toBeTruthy()
    expect(mocks.switchChain).not.toHaveBeenCalled()

    fireEvent.change(screen.getByRole('textbox', { name: 'USDC amount to split' }), {
      target: { value: '1' },
    })

    expect(screen.getByRole('button', { name: /continue/i }).hasAttribute('disabled')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Switch to Arc Mainnet' }))

    expect(mocks.switchChain).toHaveBeenCalledWith({ chainId: 5042 })
  })

  it('shows the notice and prevents continuing when the selected network has no contract address', () => {
    mocks.account.mockReturnValue({
      chainId: 5042,
      isConnected: true,
      address: '0x1111111111111111111111111111111111111111',
    })
    mocks.network = { chainId: 5042, name: 'Arc Mainnet', contractAddress: '' as `0x${string}` }

    renderAmountStep()

    expect(screen.getByText('ArcSplit contract address is not configured for this network.')).toBeTruthy()

    fireEvent.change(screen.getByRole('textbox', { name: 'USDC amount to split' }), {
      target: { value: '1' },
    })

    expect(screen.getByRole('button', { name: /continue/i }).hasAttribute('disabled')).toBe(true)
  })

  it('does not show the notice for an unsupported network', () => {
    mocks.account.mockReturnValue({
      chainId: 1,
      isConnected: true,
      address: '0x1111111111111111111111111111111111111111',
    })

    renderAmountStep()

    expect(screen.queryByText('ArcSplit contract address is not configured for this network.')).toBeNull()
    expect(screen.getByText('This network is not supported by ArcSplit. Switch to Arc Mainnet to make a payment.')).toBeTruthy()
    const switchButton = screen.getByRole('button', { name: 'Switch to Arc Mainnet' })
    expect(switchButton).toBeTruthy()
    expect(mocks.switchChain).not.toHaveBeenCalled()

    fireEvent.click(switchButton)

    expect(mocks.switchChain).toHaveBeenCalledWith({ chainId: 5042 })
  })
})

describe('raw decimal input', () => {
  beforeEach(() => {
    mocks.account.mockReturnValue({
      chainId: 5042,
      isConnected: true,
      address: '0x1111111111111111111111111111111111111111',
    })
    mocks.network = {
      chainId: 5042,
      name: 'Arc Mainnet',
      contractAddress: '0x2222222222222222222222222222222222222222',
    }
  })

  it.each([
    ['0.1', 100_000n],
    ['0.11', 110_000n],
    ['1.20', 1_200_000n],
    ['0.000001', 1n],
    ['10.50', 10_500_000n],
    ['100', 100_000_000n],
  ])('preserves %s while typing and sends its exact base-unit value', (value, expectedRaw) => {
    const { onNext } = renderAmountStep()
    const input = screen.getByRole('textbox', { name: 'USDC amount to split' }) as HTMLInputElement

    fireEvent.change(input, { target: { value } })
    expect(input.value).toBe(value)

    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onNext).toHaveBeenCalledWith(expectedRaw)
  })

  it('keeps over-precision input visible and prevents continuing', () => {
    const { onNext } = renderAmountStep()
    const input = screen.getByRole('textbox', { name: 'USDC amount to split' }) as HTMLInputElement

    fireEvent.change(input, { target: { value: '0.0000001' } })

    expect(input.value).toBe('0.0000001')
    expect(screen.getByRole('alert').textContent).toContain('up to 6 decimal places')
    expect(screen.getByRole('button', { name: /continue/i }).hasAttribute('disabled')).toBe(true)
    expect(onNext).not.toHaveBeenCalled()
  })
})
