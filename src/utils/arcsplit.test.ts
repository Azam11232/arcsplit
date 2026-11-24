import { describe, expect, it, vi } from 'vitest'
import {
  ARCSPLIT_ADDRESS,
  ARCSPLIT_MAINNET_LEGACY_ADDRESS,
  ARCSPLIT_MAINNET_NEXT_ADDRESS,
  ARCSPLIT_MAINNET_USE_NEXT_ADDRESS,
  ARC_MAINNET_CHAIN_ID,
  ARC_TESTNET_CHAIN_ID,
  formatUsdc,
  formatUsdcBalance,
  getArcNetwork,
  parseContractError,
  parseUsdc,
  splitFixedAmountsEvenly,
} from './arcsplit'

describe('ArcSplit network contract configuration', () => {
  it.each([
    ['VITE_ARCSPLIT_TESTNET_ADDRESS', 'not-an-address'],
    ['VITE_ARCSPLIT_TESTNET_ADDRESS', '0x0000000000000000000000000000000000000000'],
  ])('rejects invalid %s before configuration can be used', async (setting, value) => {
    vi.stubEnv(setting, value)
    vi.stubEnv('VITE_ARCSPLIT_MAINNET_USE_NEXT_ADDRESS', 'true')
    vi.resetModules()

    try {
      await expect(import('./arcsplit')).rejects.toThrow(setting)
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })

  it('keeps F131 as the Mainnet target and Testnet addresses isolated', async () => {
    const activeMainnetAddress = '0x2222222222222222222222222222222222222222'
    const nextMainnetAddress = '0xF13199D9bbf965eE10f41b531Ee4aa660bB54738'
    const testnetAddress = '0x4444444444444444444444444444444444444444'
    vi.stubEnv('VITE_ARCSPLIT_ADDRESS', activeMainnetAddress)
    vi.stubEnv('VITE_ARCSPLIT_MAINNET_NEXT_ADDRESS', nextMainnetAddress)
    vi.stubEnv('VITE_ARCSPLIT_MAINNET_USE_NEXT_ADDRESS', 'false')
    vi.stubEnv('VITE_ARCSPLIT_TESTNET_ADDRESS', testnetAddress)
    vi.resetModules()

    try {
      const { getArcNetwork: getFreshArcNetwork } = await import('./arcsplit')
      const mainnet = getFreshArcNetwork(ARC_MAINNET_CHAIN_ID)
      const testnet = getFreshArcNetwork(ARC_TESTNET_CHAIN_ID)

      expect(mainnet?.contractAddress).toBe(nextMainnetAddress)
      expect(mainnet?.analyticsContractAddresses).toEqual([nextMainnetAddress])
      expect(mainnet?.analyticsContractAddresses).not.toContain(ARCSPLIT_MAINNET_LEGACY_ADDRESS)
      expect(mainnet?.analyticsContractAddresses).not.toContain(activeMainnetAddress)
      expect(testnet?.contractAddress).toBe(testnetAddress)
      expect(testnet?.analyticsContractAddresses).toEqual([testnetAddress])
      expect(testnet?.analyticsContractAddresses).not.toContain(activeMainnetAddress)
      expect(mainnet?.analyticsContractAddresses).not.toContain(testnetAddress)
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })

  it('tracks only the current Mainnet contract for Analytics', () => {
    const mainnet = getArcNetwork(ARC_MAINNET_CHAIN_ID)
    expect(mainnet?.contractAddress).toBe(ARCSPLIT_MAINNET_NEXT_ADDRESS)
    expect(mainnet?.contractAddress).toBe('0xF13199D9bbf965eE10f41b531Ee4aa660bB54738')
    expect(mainnet?.analyticsContractAddresses).toEqual([ARCSPLIT_MAINNET_NEXT_ADDRESS])
    expect(mainnet?.analyticsContractAddresses).not.toContain(ARCSPLIT_MAINNET_LEGACY_ADDRESS)
    expect(mainnet?.analyticsContractAddresses).not.toContain(ARCSPLIT_ADDRESS)
  })

  it('always uses F131 as the Mainnet transaction target regardless of legacy environment flags', async () => {
    const activeAddress = '0xB7Ee9d819AA626F3ABA56ab3948bC56fa62f0E7E'
    const nextAddress = '0xF13199D9bbf965eE10f41b531Ee4aa660bB54738'
    vi.stubEnv('VITE_ARCSPLIT_ADDRESS', activeAddress)
    vi.stubEnv('VITE_ARCSPLIT_MAINNET_NEXT_ADDRESS', nextAddress)
    vi.stubEnv('VITE_ARCSPLIT_MAINNET_USE_NEXT_ADDRESS', 'false')
    vi.resetModules()

    try {
      const { getArcNetwork: getFreshArcNetwork, ARC_MAINNET_CHAIN_ID: mainnetChainId } =
        await import('./arcsplit')
      const mainnet = getFreshArcNetwork(mainnetChainId)
      expect(mainnet?.contractAddress).toBe(nextAddress)
      expect(mainnet?.analyticsContractAddresses).toEqual([nextAddress])
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })

  it('keeps Testnet analytics scoped to the configured Testnet contract', () => {
    const testnet = getArcNetwork(ARC_TESTNET_CHAIN_ID)
    expect(testnet?.analyticsContractAddresses).toEqual([testnet?.contractAddress])
  })
})

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

describe('USDC decimal parsing', () => {
  it.each([
    ['0.1', 100_000n],
    ['0.11', 110_000n],
    ['1.20', 1_200_000n],
    ['0.000001', 1n],
    ['10.50', 10_500_000n],
    ['100', 100_000_000n],
  ])('parses %s exactly to base units', (value, expectedRaw) => {
    expect(parseUsdc(value)).toBe(expectedRaw)
  })

  it.each([
    ['0.1', '0.10'],
    ['0.11', '0.11'],
    ['1.20', '1.20'],
    ['0.000001', '0.000001'],
    ['10.50', '10.50'],
    ['100', '100.00'],
  ])('formats %s exactly to %s', (value, formatted) => {
    expect(formatUsdc(parseUsdc(value))).toBe(formatted)
  })

  it('rejects precision beyond USDC decimals rather than rounding it', () => {
    expect(() => parseUsdc('0.0000001')).toThrow('up to 6 decimal places')
  })
})

describe('manual distribution errors', () => {
  it('describes mismatched recipient and amount arrays without percentage terminology', () => {
    expect(parseContractError(new Error('ArrayLengthMismatch'))).toBe(
      'Recipients and amounts must have the same length.',
    )
  })

  it('explains why ArcSplit cannot be a payout recipient', () => {
    expect(parseContractError(new Error('InvalidRecipient'))).toBe(
      'The ArcSplit contract cannot be a recipient.',
    )
  })
})

describe('even distribution helpers', () => {
  it('assigns exact fixed remainder units without using floating point', () => {
    expect(splitFixedAmountsEvenly(7n, 3)).toEqual([2n, 2n, 3n])
  })

  it('does not fabricate positive payouts when total is smaller than recipient count', () => {
    expect(splitFixedAmountsEvenly(2n, 3)).toEqual([2n, 0n, 0n])
  })
})
