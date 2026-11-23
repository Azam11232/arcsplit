/**
 * ArcSplit contract config and utilities.
 *
 * Contract and USDC addresses are selected by chain. ERC-20 USDC amounts use
 * the token's 6 decimals; Arc's native gas currency has 18 decimals.
 */

import { getUsdc, requireChain } from '@/onchain-facts'
import { AmountError, formatUnitsExact, parseUsdc as parseUsdcExact } from '@/onchain-money'
import { isAddress, type Address } from 'viem'

export const ARC_MAINNET_CHAIN_ID = 5042
export const ARC_TESTNET_CHAIN_ID = 5042002

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export function validateContractAddress(address: string, setting: string): Address {
  const normalized = address.trim()
  if (!isAddress(normalized) || normalized.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`${setting} must be a valid, non-zero contract address.`)
  }
  return normalized as Address
}

function validateOptionalContractAddress(
  address: string | undefined,
  setting: string,
): Address | undefined {
  return address === undefined || address === ''
    ? undefined
    : validateContractAddress(address, setting)
}

const mainnetUsdc = getUsdc(ARC_MAINNET_CHAIN_ID)
if (!mainnetUsdc) throw new Error('USDC not registered for Arc Mainnet in onchain-facts')
const testnetUsdc = getUsdc(ARC_TESTNET_CHAIN_ID)
if (!testnetUsdc) throw new Error('USDC not registered for Arc Testnet in onchain-facts')

export const USDC_ADDRESS = mainnetUsdc.address as `0x${string}`
export const USDC_DECIMALS = mainnetUsdc.decimals

export const ARCSPLIT_MAINNET_LEGACY_ADDRESS =
  validateContractAddress(
    '0xB7Ee9d819AA626F3ABA56ab3948bC56fa62f0E7E',
    'ArcSplit Mainnet legacy address',
  )
export const ARCSPLIT_ADDRESS = ARCSPLIT_MAINNET_LEGACY_ADDRESS
export const ARCSPLIT_MAINNET_NEXT_ADDRESS = validateContractAddress(
  '0xF13199D9bbf965eE10f41b531Ee4aa660bB54738',
  'ArcSplit Mainnet next address',
)
export const ARCSPLIT_MAINNET_USE_NEXT_ADDRESS = true
const mainnetTransactionAddress = ARCSPLIT_MAINNET_NEXT_ADDRESS
const TESTNET_ARCSPLIT_ADDRESS = import.meta.env.VITE_ARCSPLIT_TESTNET_ADDRESS === undefined
  ? validateContractAddress(
    '0x0c4DC391c39641B5DEa9304454B99B37c9FFFb35',
    'ArcSplit Testnet default address',
  )
  : validateContractAddress(
    import.meta.env.VITE_ARCSPLIT_TESTNET_ADDRESS,
    'VITE_ARCSPLIT_TESTNET_ADDRESS',
  )

export interface ArcNetwork {
  chainId: number
  name: string
  usdcAddress: `0x${string}`
  usdcDecimals: number
  contractAddress: `0x${string}`
  analyticsContractAddresses: readonly `0x${string}`[]
  explorerBase: string
}

export function isProductionArcEnvironment(): boolean {
  return import.meta.env.PROD
}

function uniqueAddresses(addresses: readonly (string | undefined)[]): `0x${string}`[] {
  const found = new Map<string, `0x${string}`>()
  for (const address of addresses) {
    if (!address) continue
    const checksummedAddress = validateContractAddress(
      address,
      'An ArcSplit analytics contract address',
    )
    const normalized = checksummedAddress.toLowerCase()
    if (!found.has(normalized)) found.set(normalized, checksummedAddress)
  }
  return [...found.values()]
}

const arcNetworks: Record<number, ArcNetwork> = {
  [ARC_MAINNET_CHAIN_ID]: {
    chainId: ARC_MAINNET_CHAIN_ID,
    name: 'Arc Mainnet',
    usdcAddress: mainnetUsdc.address as `0x${string}`,
    usdcDecimals: mainnetUsdc.decimals,
    contractAddress: mainnetTransactionAddress,
    analyticsContractAddresses: uniqueAddresses([
      ARCSPLIT_MAINNET_LEGACY_ADDRESS,
      ARCSPLIT_ADDRESS,
      ARCSPLIT_MAINNET_NEXT_ADDRESS,
    ]),
    explorerBase: requireChain(ARC_MAINNET_CHAIN_ID).explorerBase,
  },
  [ARC_TESTNET_CHAIN_ID]: {
    chainId: ARC_TESTNET_CHAIN_ID,
    name: 'Arc Testnet',
    usdcAddress: testnetUsdc.address as `0x${string}`,
    usdcDecimals: testnetUsdc.decimals,
    contractAddress: TESTNET_ARCSPLIT_ADDRESS,
    analyticsContractAddresses: uniqueAddresses([TESTNET_ARCSPLIT_ADDRESS]),
    explorerBase: requireChain(ARC_TESTNET_CHAIN_ID).explorerBase,
  },
}

export function getArcNetwork(chainId: number | undefined): ArcNetwork | undefined {
  if (chainId === undefined) return undefined
  if (isProductionArcEnvironment() && chainId === ARC_TESTNET_CHAIN_ID) return undefined
  return arcNetworks[chainId]
}

export const ARCSPLIT_ABI = [
  {
    type: 'constructor',
    inputs: [{ name: 'usdc_', type: 'address', internalType: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'Distributed',
    inputs: [
      { name: 'payer', type: 'address', indexed: true, internalType: 'address' },
      { name: 'totalAmount', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'recipientCount', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'RecipientPayout',
    inputs: [
      { name: 'recipient', type: 'address', indexed: true, internalType: 'address' },
      { name: 'amount', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
    anonymous: false,
  },
  { type: 'error', name: 'ZeroAmount', inputs: [] },
  { type: 'error', name: 'ArrayLengthMismatch', inputs: [] },
  { type: 'error', name: 'TooManyRecipients', inputs: [] },
  { type: 'error', name: 'ZeroAddress', inputs: [] },
  { type: 'error', name: 'InvalidRecipient', inputs: [] },
  { type: 'error', name: 'DuplicateRecipient', inputs: [] },
] as const

export const ARCSPLIT_FIXED_ABI = [
  ...ARCSPLIT_ABI,
  {
    type: 'function',
    name: 'distributeFixedAmounts',
    inputs: [
      { name: 'recipients', type: 'address[]', internalType: 'address[]' },
      { name: 'amounts', type: 'uint256[]', internalType: 'uint256[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

// ── Formatting helpers ────────────────────────────────────────────────────────

/** Parse a human-entered USDC string to smallest unit (BigInt, 6 decimals). */
export function parseUsdc(value: string): bigint {
  if (!/^\d*\.?\d+$|^\d+\.$/.test(value)) {
    throw new Error('Enter a valid USDC amount.')
  }
  try {
    return parseUsdcExact(value)
  } catch (error) {
    if (error instanceof AmountError && error.code === 'TOO_MANY_FRACTION_DIGITS') {
      throw new Error(`USDC amounts support up to ${USDC_DECIMALS} decimal places.`)
    }
    throw error
  }
}

export function getUsdcInputError(value: string): string | undefined {
  if (!/^\d*(?:\.\d*)?$/.test(value)) {
    return 'Enter a valid USDC amount.'
  }
  if ((value.split('.')[1]?.length ?? 0) > USDC_DECIMALS) {
    return `USDC amounts support up to ${USDC_DECIMALS} decimal places.`
  }
  return undefined
}

/** Format a USDC raw bigint exactly, with at least 2 and at most 6 decimals. */
export function formatUsdc(raw: bigint): string {
  const formatted = formatUnitsExact(raw, USDC_DECIMALS)
  if (!formatted.includes('.')) return `${formatted}.00`
  const [whole, fraction = ''] = formatted.split('.')
  return `${whole}.${fraction.padEnd(2, '0')}`
}

/** Round a wallet balance to cents, preserving exact display for nonzero sub-cent values. */
export function formatUsdcBalance(raw: bigint): string {
  const cents = (raw + 5_000n) / 10_000n
  if (raw > 0n && cents === 0n) return formatUsdc(raw)

  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const fraction = (cents % 100n).toString().padStart(2, '0')
  return `${whole}.${fraction}`
}

/** Format an address to 0x1234…5678 */
export function shortAddress(addr: string): string {
  if (addr.length < 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

/** Parse a user-facing onchain error message to a friendly string */
export function parseContractError(err: unknown): string {
  if (!err) return 'Something went wrong.'
  const msg = (err as { message?: string })?.message ?? JSON.stringify(err)
  const lower = msg.toLowerCase()

  if (lower.includes('user rejected') || lower.includes('user denied')) return 'Transaction cancelled.'
  if (lower.includes('zeroamount')) return 'Amount must be greater than zero.'
  if (lower.includes('arraylenthmismatch') || lower.includes('arraylength')) return 'Recipients and amounts must have the same length.'
  if (lower.includes('toomanyrecipients')) return 'Maximum 50 recipients allowed.'
  if (lower.includes('zeroaddress')) return 'A recipient address is invalid (zero address).'
  if (lower.includes('invalidrecipient')) return 'The ArcSplit contract cannot be a recipient.'
  if (lower.includes('duplicaterecipient')) return 'Duplicate recipient address detected.'
  if (lower.includes('insufficient allowance') || lower.includes('erc20insufficientallowance')) {
    return 'Insufficient allowance. Please approve first.'
  }
  if (lower.includes('insufficient balance') || lower.includes('erc20insufficientbalance')) {
    return 'Insufficient USDC balance.'
  }
  if (lower.includes('reverted')) return 'Transaction reverted. Check your inputs and try again.'
  if (lower.includes('network') || lower.includes('timeout')) return 'Network error. Please retry.'
  return 'Transaction failed. Please try again.'
}

// ── Recipient types ───────────────────────────────────────────────────────────

export interface Recipient {
  id: string
  address: string
  /** Exact 6-decimal USDC amount in smallest units. */
  amountRaw: bigint
}

/** Validate an Ethereum address */
export function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr) &&
    addr.toLowerCase() !== '0x0000000000000000000000000000000000000000'
}

export function splitFixedAmountsEvenly(totalRaw: bigint, recipientCount: number): bigint[] {
  if (recipientCount <= 0 || recipientCount > 50) return []
  if (totalRaw < 0n) return []

  const base = totalRaw / BigInt(recipientCount)
  if (base === 0n) {
    return recipientCount === 0
      ? []
      : [totalRaw, ...Array(recipientCount - 1).fill(0n)]
  }

  return Array.from({ length: recipientCount }, (_, index) =>
    index === recipientCount - 1
      ? totalRaw - base * BigInt(recipientCount - 1)
      : base,
  )
}

/** Build a tx explorer URL */
export function txUrl(chainId: number, hash: string): string {
  const network = getArcNetwork(chainId)
  if (!network) throw new Error(`Unsupported Arc chain ID: ${chainId}`)
  return `${network.explorerBase}/tx/${hash}`
}
