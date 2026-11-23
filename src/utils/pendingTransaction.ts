interface PendingTransactionBase {
  txHash: `0x${string}`
  amountRaw: string
  recipients: Array<{ address: string; amountRaw: string }>
}

export type PendingTransactionRecord =
  | (PendingTransactionBase & { kind: 'approval'; contractAddress: `0x${string}` })
  | (PendingTransactionBase & { kind: 'distribution'; contractAddress: `0x${string}` })

const PREFIX = 'arcsplit.pending.v2'
const LEGACY_PREFIX = 'arcsplit.pending.v1'

function getSessionStorage(): Storage | undefined {
  try {
    return typeof globalThis.sessionStorage === 'undefined'
      ? undefined
      : globalThis.sessionStorage
  } catch {
    return undefined
  }
}

function storageKey(
  prefix: string,
  accountAddress: string | undefined,
  chainId: number | undefined,
  contractAddress: string | undefined,
): string | undefined {
  if (!accountAddress || chainId === undefined || !contractAddress) return undefined
  return `${prefix}.${accountAddress.toLowerCase()}.${chainId}.${contractAddress.toLowerCase()}`
}

function legacyStorageKey(accountAddress: string | undefined, chainId: number | undefined): string | undefined {
  if (!accountAddress || chainId === undefined) return undefined
  return `${LEGACY_PREFIX}.${accountAddress.toLowerCase()}.${chainId}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isRawAmount(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return false
  try {
    return BigInt(value) >= 0n
  } catch {
    return false
  }
}

function isRecipient(value: unknown): value is { address: string; amountRaw: string } {
  return isRecord(value)
    && typeof value.address === 'string'
    && /^0x[0-9a-fA-F]{40}$/.test(value.address)
    && value.address.toLowerCase() !== '0x0000000000000000000000000000000000000000'
    && isRawAmount(value.amountRaw)
}

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === 'string'
    && /^0x[0-9a-fA-F]{40}$/.test(value)
    && value.toLowerCase() !== '0x0000000000000000000000000000000000000000'
}

function isPendingTransaction(value: unknown): value is PendingTransactionRecord {
  if (
    !isRecord(value)
    || (value.kind !== 'approval' && value.kind !== 'distribution')
    || typeof value.txHash !== 'string'
    || !/^0x[0-9a-fA-F]{64}$/.test(value.txHash)
    || !isRawAmount(value.amountRaw)
    || !isAddress(value.contractAddress)
    || !Array.isArray(value.recipients)
    || value.recipients.length === 0
    || value.recipients.length > 50
    || !value.recipients.every(isRecipient)
  ) return false
  return true
}

export function getPendingTransaction(
  accountAddress: string | undefined,
  chainId: number | undefined,
  expectedContractAddress?: `0x${string}`,
): PendingTransactionRecord | undefined {
  const key = storageKey(PREFIX, accountAddress, chainId, expectedContractAddress)
  const oldKey = legacyStorageKey(accountAddress, chainId)
  const storage = getSessionStorage()
  if (!expectedContractAddress || !key || !oldKey || !storage) return undefined

  try {
    const targetRaw = storage.getItem(key)
    if (targetRaw) {
      const targetValue: unknown = JSON.parse(targetRaw)
      if (
        isPendingTransaction(targetValue)
        && targetValue.contractAddress.toLowerCase() === expectedContractAddress.toLowerCase()
      ) return targetValue
    }

    const legacyRaw = storage.getItem(oldKey)
    if (!legacyRaw) return undefined
    const legacyValue: unknown = JSON.parse(legacyRaw)
    return isPendingTransaction(legacyValue)
      && legacyValue.contractAddress.toLowerCase() === expectedContractAddress.toLowerCase()
      ? legacyValue
      : undefined
  } catch {
    return undefined
  }
}

export function savePendingTransaction(
  accountAddress: string | undefined,
  chainId: number | undefined,
  transaction: PendingTransactionRecord,
): boolean {
  const key = storageKey(PREFIX, accountAddress, chainId, transaction.contractAddress)
  const oldKey = legacyStorageKey(accountAddress, chainId)
  const storage = getSessionStorage()
  if (!key || !oldKey || !storage || !isPendingTransaction(transaction)) return false

  try {
    storage.setItem(key, JSON.stringify(transaction))
    const legacyRaw = storage.getItem(oldKey)
    if (legacyRaw) {
      const legacyValue: unknown = JSON.parse(legacyRaw)
      if (
        isPendingTransaction(legacyValue)
        && legacyValue.contractAddress.toLowerCase() === transaction.contractAddress.toLowerCase()
      ) storage.removeItem(oldKey)
    }
    return true
  } catch {
    return false
  }
}

export function clearPendingTransaction(
  accountAddress: string | undefined,
  chainId: number | undefined,
  contractAddress: `0x${string}` | undefined,
): boolean {
  const key = storageKey(PREFIX, accountAddress, chainId, contractAddress)
  const oldKey = legacyStorageKey(accountAddress, chainId)
  const storage = getSessionStorage()
  if (!contractAddress || !key || !oldKey || !storage) return false

  try {
    storage.removeItem(key)
    const legacyRaw = storage.getItem(oldKey)
    if (legacyRaw) {
      const legacyValue: unknown = JSON.parse(legacyRaw)
      if (
        isPendingTransaction(legacyValue)
        && legacyValue.contractAddress.toLowerCase() === contractAddress.toLowerCase()
      ) storage.removeItem(oldKey)
    }
    return true
  } catch {
    return false
  }
}
