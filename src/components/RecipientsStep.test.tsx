import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecipientsStep } from './RecipientsStep'
import type { Recipient } from '@/utils/arcsplit'

vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    chainId: 5042,
  }),
}))

const recipients = [
  { id: 'alice', address: '0x1111111111111111111111111111111111111111', amountRaw: 1_000_000n },
  { id: 'bob', address: '0x2222222222222222222222222222222222222222', amountRaw: 1_000_000n },
]

function renderRecipients(
  amountRaw = 2_000_000n,
  currentRecipients = recipients,
) {
  const onChange = vi.fn<(recipients: Recipient[]) => void>()
  const onNext = vi.fn()
  function ControlledRecipients() {
    const [current, setCurrent] = useState(currentRecipients)
    return (
      <RecipientsStep
        amountRaw={amountRaw}
        recipients={current}
        onChange={(next) => {
          onChange(next)
          setCurrent(next)
        }}
        onNext={onNext}
        onBack={vi.fn()}
      />
    )
  }
  const view = render(<ControlledRecipients />)
  return { ...view, onChange, onNext }
}

afterEach(cleanup)

describe('manual-only recipient allocation', () => {
  it('shows exact USDC amount inputs and no percentage mode controls', () => {
    renderRecipients()

    expect(screen.getByRole('textbox', { name: 'Recipient 1 USDC amount' })).toBeTruthy()
    expect(screen.queryByText('Percentage')).toBeNull()
    expect(screen.queryByLabelText('Distribution mode')).toBeNull()
    expect(screen.getByRole('button', { name: /review split/i }).hasAttribute('disabled')).toBe(false)
  })

  it('updates allocation immediately and disables review while under-allocated', () => {
    renderRecipients()

    fireEvent.change(screen.getByRole('textbox', { name: 'Recipient 2 USDC amount' }), {
      target: { value: '0.75' },
    })

    expect(screen.getByText('0.25 USDC remaining')).toBeTruthy()
    expect(screen.getByRole('button', { name: /review split/i }).hasAttribute('disabled')).toBe(true)
  })

  it('reports over-allocation live and prevents review', () => {
    renderRecipients()

    fireEvent.change(screen.getByRole('textbox', { name: 'Recipient 2 USDC amount' }), {
      target: { value: '1.250001' },
    })

    expect(screen.getByRole('alert').textContent).toContain('Over-allocation by 0.250001 USDC')
    expect(screen.getByRole('button', { name: /review split/i }).hasAttribute('disabled')).toBe(true)
  })

  it('adds and removes recipients while preserving manual amount data', () => {
    const { onChange } = renderRecipients()

    fireEvent.click(screen.getByRole('button', { name: 'Add Recipient' }))
    const added = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0]
    expect(added).toHaveLength(3)
    expect(added[2]).toMatchObject({ address: '', amountRaw: 0n })

    fireEvent.click(screen.getByRole('button', { name: 'Remove recipient 3' }))
    expect(onChange.mock.calls[onChange.mock.calls.length - 1]?.[0]).toHaveLength(2)
  })

  it.each([
    ['0.1', 100_000n],
    ['0.11', 110_000n],
    ['1.20', 1_200_000n],
    ['0.000001', 1n],
    ['10.50', 10_500_000n],
    ['100', 100_000_000n],
  ])('preserves %s as typed and stores the exact base-unit amount', (value, expectedRaw) => {
    const { onChange } = renderRecipients(200_000_000n)
    const input = screen.getByRole('textbox', { name: 'Recipient 1 USDC amount' }) as HTMLInputElement

    fireEvent.change(input, { target: { value } })

    expect(input.value).toBe(value)
    const calls = onChange.mock.calls
    expect(calls[calls.length - 1]?.[0][0]?.amountRaw).toBe(expectedRaw)
  })

  it('keeps invalid precision visible and blocks Review', () => {
    renderRecipients()
    const input = screen.getByRole('textbox', { name: 'Recipient 1 USDC amount' }) as HTMLInputElement

    fireEvent.change(input, { target: { value: '0.0000001' } })

    expect(input.value).toBe('0.0000001')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('alert').textContent).toContain('up to 6 decimal places')
    expect(screen.getByRole('button', { name: /review split/i }).hasAttribute('disabled')).toBe(true)
  })
})
