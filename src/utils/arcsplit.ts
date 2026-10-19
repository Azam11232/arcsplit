/**
 * ArcSplit contract config and utilities.
 *
 * The contract address below is set after deployment. Until deployed, it is
 * left as an empty string — the UI will show a "not deployed" banner.
 *
 * USDC address is read from @/onchain-facts (Arc Testnet: 0x3600...0000).
 */

import { getUsdc, requireChain } from '@/onchain-facts'

// Arc Testnet chain ID
export const ARC_TESTNET_CHAIN_ID = 5042002

// Resolved from onchain-facts registry — do not hardcode
const usdcFact = getUsdc(ARC_TESTNET_CHAIN_ID)
if (!usdcFact) throw new Error('USDC not registered for Arc Testnet in onchain-facts')
export const USDC_ADDRESS = usdcFact.address as `0x${string}`
export const USDC_DECIMALS = usdcFact.decimals // 6

const chainFact = requireChain(ARC_TESTNET_CHAIN_ID)
export const EXPLORER_BASE = chainFact.explorerBase

/**
 * ArcSplit contract address — fill in after deployment.
 * Set VITE_ARCSPLIT_ADDRESS in .env to override.
 */
export const ARCSPLIT_ADDRESS = (
  import.meta.env.VITE_ARCSPLIT_ADDRESS ?? ''
) as `0x${string}`

export const ARCSPLIT_ABI = [
  {
    type: 'constructor',
    inputs: [{ name: 'usdc_', type: 'address', internalType: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'distribute',
    inputs: [
      { name: 'recipients', type: 'address[]', internalType: 'address[]' },
      { name: 'sharesBps', type: 'uint256[]', internalType: 'uint256[]' },
      { name: 'totalAmount', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [],
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
  { type: 'error', name: 'DuplicateRecipient', inputs: [] },
  { type: 'error', name: 'ZeroShare', inputs: [] },
  { type: 'error', name: 'InvalidSharesTotal', inputs: [] },
] as const

// ── Formatting helpers ────────────────────────────────────────────────────────

/** Parse a human-entered USDC string to smallest unit (BigInt, 6 decimals) */
export function parseUsdc(value: string): bigint {
  const [intPart, fracPart = ''] = value.split('.')
  const frac = fracPart.slice(0, USDC_DECIMALS).padEnd(USDC_DECIMALS, '0')
  return BigInt(intPart || '0') * BigInt(10 ** USDC_DECIMALS) + BigInt(frac)
}

/** Format a USDC raw bigint to a display string with 2 decimal places */
export function formatUsdc(raw: bigint): string {
  const divisor = BigInt(10 ** USDC_DECIMALS)
  const whole = raw / divisor
  const frac = raw % divisor
  const fracStr = frac.toString().padStart(USDC_DECIMALS, '0').slice(0, 2)
  return `${whole}.${fracStr}`
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
  if (lower.includes('arraylenthmismatch') || lower.includes('arraylength')) return 'Recipients and shares must have the same length.'
  if (lower.includes('toomanyrecipients')) return 'Maximum 50 recipients allowed.'
  if (lower.includes('zeroaddress')) return 'A recipient address is invalid (zero address).'
  if (lower.includes('duplicaterecipient')) return 'Duplicate recipient address detected.'
  if (lower.includes('zeroshare')) return 'All share percentages must be greater than 0%.'
  if (lower.includes('invalidsharestotal')) return 'Share percentages must add up to exactly 100%.'
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
  /** Basis points: 0–10000 */
  sharesBps: number
}

/** Validate an Ethereum address */
export function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr)
}

/** Compute per-recipient payout amounts given totalRaw (6-decimal bigint) */
export function computePayouts(
  recipients: Recipient[],
  totalRaw: bigint
): bigint[] {
  const payouts: bigint[] = []
  let soFar = 0n
  for (let i = 0; i < recipients.length; i++) {
    if (i === recipients.length - 1) {
      payouts.push(totalRaw - soFar)
    } else {
      const amount = (totalRaw * BigInt(recipients[i].sharesBps)) / 10000n
      payouts.push(amount)
      soFar += amount
    }
  }
  return payouts
}

/** Build a tx explorer URL */
export function txUrl(hash: string): string {
  return `${EXPLORER_BASE}/tx/${hash}`
}
