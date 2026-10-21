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
  network: undefined as {
    chainId: number
    name: string
    contractAddress: `0x${string}`
  } | undefined,
}))

vi.mock('wagmi', () => ({
  useAccount: mocks.account,
  useSwitchChain: () => ({ switchChain: vi.fn() }),
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
  useUsdcBalance: () => ({ raw: 0n, formatted: '0.00', isLoading: false }),
}))

vi.mock('@/utils/arcsplit', () => ({
  ARC_MAINNET_CHAIN_ID: 5042,
  formatUsdc: vi.fn(() => '0.00'),
  getArcNetwork: mocks.getArcNetwork,
  parseUsdc: vi.fn(() => 1_000_000n),
}))

function renderAmountStep() {
  return render(<AmountStep onNext={vi.fn()} />)
}

beforeEach(() => {
  mocks.account.mockReturnValue({ chainId: undefined, isConnected: false, address: undefined })
  mocks.network = undefined
  mocks.getArcNetwork.mockImplementation(() => mocks.network)
})

afterEach(cleanup)

describe('AmountStep contract address notice', () => {
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
    expect(screen.getByRole('button', { name: 'Switch to Arc Mainnet' })).toBeTruthy()
  })
})
