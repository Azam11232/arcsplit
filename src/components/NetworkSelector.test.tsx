import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NetworkSelector } from './NetworkSelector'

const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  switchChainAsync: vi.fn(),
}))

vi.mock('wagmi', async (importOriginal) => ({
  ...await importOriginal<typeof import('wagmi')>(),
  useAccount: mocks.account,
  useSwitchChain: () => ({ mutateAsync: mocks.switchChainAsync, isPending: false }),
}))

beforeEach(() => {
  mocks.account.mockReturnValue({ chainId: 5042, isConnected: true })
  mocks.switchChainAsync.mockReset().mockResolvedValue({})
})

afterEach(cleanup)

describe('NetworkSelector', () => {
  it('offers both Arc networks in development and switches the connected wallet', async () => {
    render(<NetworkSelector />)
    const selector = screen.getByRole('combobox', { name: 'Network' }) as HTMLSelectElement

    expect([...selector.options].map((option) => option.textContent)).toEqual([
      'Arc Mainnet',
      'Arc Testnet',
    ])
    expect(selector.value).toBe('5042')
    fireEvent.change(selector, { target: { value: '5042002' } })

    await waitFor(() => {
      expect(mocks.switchChainAsync).toHaveBeenCalledWith({ chainId: 5042002 })
    })
  })

  it('reports a rejected chain switch', async () => {
    mocks.switchChainAsync.mockRejectedValue(new Error('User rejected the request.'))
    render(<NetworkSelector />)

    fireEvent.change(screen.getByRole('combobox', { name: 'Network' }), {
      target: { value: '5042002' },
    })

    expect((await screen.findByRole('alert')).textContent).toContain('User rejected the request.')
  })

  it('shows the actual unsupported network and offers only configured networks', () => {
    mocks.account.mockReturnValue({ chainId: 1, isConnected: true })
    render(<NetworkSelector />)
    const selector = screen.getByRole('combobox', { name: 'Network' }) as HTMLSelectElement

    expect(selector.options[0]?.textContent).toBe('Unsupported network (1)')
    expect([...selector.options].map((option) => option.textContent)).toEqual([
      'Unsupported network (1)',
      'Arc Mainnet',
      'Arc Testnet',
    ])
  })

  it('does not request a chain switch while disconnected', () => {
    mocks.account.mockReturnValue({ chainId: undefined, isConnected: false })
    render(<NetworkSelector />)

    expect(screen.getByRole('combobox', { name: 'Network' }).getAttribute('disabled')).not.toBeNull()
    expect(screen.getByRole('option', { name: 'Wallet not connected' })).toBeTruthy()
  })
})
