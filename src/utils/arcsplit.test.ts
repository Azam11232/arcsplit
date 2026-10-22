import { describe, expect, it } from 'vitest'
import { formatUsdcBalance } from './arcsplit'

describe('formatUsdcBalance', () => {
  it('rounds wallet balances to two decimal places', () => {
    expect(formatUsdcBalance(115_042n)).toBe('0.12')
    expect(formatUsdcBalance(5_000n)).toBe('0.01')
  })

  it('adds thousands separators to large balances', () => {
    expect(formatUsdcBalance(1_250_500_000n)).toBe('1,250.50')
  })

  it('formats zero with two decimal places', () => {
    expect(formatUsdcBalance(0n)).toBe('0.00')
  })

  it('preserves precision for nonzero balances smaller than half a cent', () => {
    expect(formatUsdcBalance(4_999n)).toBe('0.004999')
    expect(formatUsdcBalance(1n)).toBe('0.000001')
  })
})
