import type { Recipient } from './arcsplit'

export interface SavedRecipient {
  id: string
  name: string
  address: string
  createdAt: number
}

export interface SplitTemplate {
  id: string
  name: string
  mode: 'percentage' | 'fixed'
  recipients: Array<{ address: string; sharesBps: number; amountRaw: string }>
  createdAt: number
  updatedAt: number
}

export interface SplitHistoryEntry {
  id: string
  txHash: `0x${string}`
  chainId: number
  status?: 'success' | 'failed'
  contractAddress?: `0x${string}`
  mode: 'percentage' | 'fixed'
  totalRaw: string
  recipients: Array<{ address: string; amountRaw: string }>
  createdAt: number
}

export type NewSplitHistoryEntry = Omit<SplitHistoryEntry, 'id' | 'createdAt' | 'status'> & {
  status: 'success' | 'failed'
}

interface StoredData {
  recipients: SavedRecipient[]
  templates: SplitTemplate[]
  history: SplitHistoryEntry[]
}

const PREFIX = 'arcsplit.v1'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAddress(value: unknown): value is string {
  return typeof value === 'string'
    && /^0x[0-9a-fA-F]{40}$/.test(value)
    && value.toLowerCase() !== '0x0000000000000000000000000000000000000000'
}

function isSafeNonnegativeRaw(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d+$/.test(value)
    && (() => {
      try {
        return BigInt(value) >= 0n
      } catch {
        return false
      }
    })()
}

function isSavedRecipient(value: unknown): value is SavedRecipient {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.name === 'string'
    && isAddress(value.address)
    && typeof value.createdAt === 'number'
    && Number.isFinite(value.createdAt)
}

function isTemplate(value: unknown): value is SplitTemplate {
  if (!isRecord(value)) return false
  if (typeof value.id !== 'string'
    || typeof value.name !== 'string'
    || (value.mode !== 'percentage' && value.mode !== 'fixed')
    || typeof value.createdAt !== 'number'
    || typeof value.updatedAt !== 'number'
    || !Array.isArray(value.recipients)
  ) return false
  return value.recipients.every((recipient) => isRecord(recipient)
    && isAddress(recipient.address)
    && typeof recipient.sharesBps === 'number'
    && Number.isInteger(recipient.sharesBps)
    && recipient.sharesBps >= 0
    && recipient.sharesBps <= 10000
    && isSafeNonnegativeRaw(recipient.amountRaw))
}

function isHistory(value: unknown): value is SplitHistoryEntry {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.txHash === 'string'
    && /^0x[0-9a-fA-F]{64}$/.test(value.txHash)
    && typeof value.chainId === 'number'
    && Number.isInteger(value.chainId)
    && (value.status === undefined || value.status === 'success' || value.status === 'failed')
    && (value.contractAddress === undefined || isAddress(value.contractAddress))
    && (value.mode === 'percentage' || value.mode === 'fixed')
    && isSafeNonnegativeRaw(value.totalRaw)
    && typeof value.createdAt === 'number'
    && Number.isSafeInteger(value.createdAt)
    && Math.abs(value.createdAt) <= 8_640_000_000_000_000
    && Array.isArray(value.recipients)
    && value.recipients.every((recipient) => isRecord(recipient)
      && isAddress(recipient.address)
      && isSafeNonnegativeRaw(recipient.amountRaw))
}

function getLocalStorage(): Storage | undefined {
  try {
    return typeof globalThis.localStorage !== 'undefined'
      ? globalThis.localStorage
      : undefined
  } catch {
    return undefined
  }
}

function scope(address: string | undefined, chainId: number | undefined): string {
  const account = address?.toLowerCase() ?? 'disconnected'
  return `${PREFIX}.${account}.${chainId ?? 'unsupported'}`
}

function emptyData(): StoredData {
  return { recipients: [], templates: [], history: [] }
}

function read(address: string | undefined, chainId: number | undefined): StoredData {
  try {
    const storage = getLocalStorage()
    if (!storage) return emptyData()
    const raw = storage.getItem(scope(address, chainId))
    if (!raw) return emptyData()
    const parsed = JSON.parse(raw) as Partial<StoredData>
    return {
      recipients: Array.isArray(parsed.recipients)
        ? parsed.recipients.filter(isSavedRecipient)
        : [],
      templates: Array.isArray(parsed.templates)
        ? parsed.templates.filter(isTemplate)
        : [],
      history: Array.isArray(parsed.history)
        ? parsed.history.filter(isHistory)
        : [],
    }
  } catch {
    return emptyData()
  }
}

export function getSplitStorageData(
  address: string | undefined,
  chainId: number | undefined,
): StoredData {
  return read(address, chainId)
}

function write(address: string | undefined, chainId: number | undefined, data: StoredData): boolean {
  const storage = getLocalStorage()
  if (!storage) return false

  try {
    storage.setItem(scope(address, chainId), JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

export function getSavedRecipients(address: string | undefined, chainId: number | undefined): SavedRecipient[] {
  return read(address, chainId).recipients
}

export function saveRecipient(
  address: string | undefined,
  chainId: number | undefined,
  recipient: Omit<SavedRecipient, 'id' | 'createdAt'>,
): SavedRecipient[] {
  const data = read(address, chainId)
  const normalized = recipient.address.toLowerCase()
  const existing = data.recipients.find((item) => item.address.toLowerCase() === normalized)
  if (existing) {
    existing.name = recipient.name.trim() || existing.name
  } else {
    data.recipients.unshift({
      ...recipient,
      address: recipient.address,
      id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      createdAt: Date.now(),
    })
  }
  write(address, chainId, data)
  return data.recipients
}

export function removeSavedRecipient(address: string | undefined, chainId: number | undefined, id: string): SavedRecipient[] {
  const data = read(address, chainId)
  data.recipients = data.recipients.filter((item) => item.id !== id)
  write(address, chainId, data)
  return data.recipients
}

export function getTemplates(address: string | undefined, chainId: number | undefined): SplitTemplate[] {
  return read(address, chainId).templates
}

export function saveTemplate(
  address: string | undefined,
  chainId: number | undefined,
  name: string,
  recipients: Recipient[],
): SplitTemplate[] {
  const data = read(address, chainId)
  const now = Date.now()
  data.templates.unshift({
    id: crypto.randomUUID?.() ?? `${now}-${Math.random().toString(36).slice(2)}`,
    name: name.trim(),
    mode: 'fixed',
    recipients: recipients.map((recipient) => ({
      address: recipient.address,
      sharesBps: 0,
      amountRaw: recipient.amountRaw.toString(),
    })),
    createdAt: now,
    updatedAt: now,
  })
  write(address, chainId, data)
  return data.templates
}

export function removeTemplate(address: string | undefined, chainId: number | undefined, id: string): SplitTemplate[] {
  const data = read(address, chainId)
  data.templates = data.templates.filter((item) => item.id !== id)
  write(address, chainId, data)
  return data.templates
}

export function getHistory(address: string | undefined, chainId: number | undefined): SplitHistoryEntry[] {
  return read(address, chainId).history
}

export function addHistoryEntry(
  address: string | undefined,
  chainId: number | undefined,
  entry: NewSplitHistoryEntry,
): boolean {
  const data = read(address, chainId)
  if (data.history.some((item) => item.txHash.toLowerCase() === entry.txHash.toLowerCase())) {
    return true
  }
  data.history.unshift({
    ...entry,
    id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: Date.now(),
  })
  return write(address, chainId, data)
}
