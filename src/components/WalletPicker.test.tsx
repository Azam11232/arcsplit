import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WalletPicker } from './WalletPicker'

const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  connectAsync: vi.fn(),
  disconnectAsync: vi.fn(),
  connector: { uid: 'injected:browser', id: 'injected', name: 'Injected', type: 'injected' },
}))

vi.mock('wagmi', () => ({
  useAccount: mocks.account,
  useConnectors: () => [mocks.connector],
  useConnect: () => ({ mutateAsync: mocks.connectAsync, isPending: false }),
  useDisconnect: () => ({ mutateAsync: mocks.disconnectAsync, isPending: false }),
}))

beforeEach(() => {
  mocks.account.mockReturnValue({ address: undefined, isConnected: false })
  mocks.connectAsync.mockReset().mockResolvedValue({})
  mocks.disconnectAsync.mockReset().mockResolvedValue({})
})

afterEach(cleanup)

describe('WalletPicker', () => {
  it('connects through the configured injected connector and closes on success', async () => {
    render(<WalletPicker variant="primary" />)

    fireEvent.click(screen.getByRole('button', { name: /connect wallet/i }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /browser wallet/i }))

    await waitFor(() => {
      expect(mocks.connectAsync).toHaveBeenCalledWith({ connector: mocks.connector })
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  it('shows connection errors instead of hiding a failed wallet request', async () => {
    mocks.connectAsync.mockRejectedValue(new Error('User rejected the connection.'))
    render(<WalletPicker />)

    fireEvent.click(screen.getByRole('button', { name: /connect wallet/i }))
    fireEvent.click(screen.getByRole('button', { name: /browser wallet/i }))

    expect((await screen.findByRole('alert')).textContent).toContain('User rejected the connection.')
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('shows the connected account and disconnects on request', async () => {
    mocks.account.mockReturnValue({
      address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      isConnected: true,
    })
    render(<WalletPicker />)

    fireEvent.click(screen.getByRole('button', { name: /0xaaaa/i }))
    expect(screen.getByText('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /disconnect/i }))

    await waitFor(() => {
      expect(mocks.disconnectAsync).toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })
})
