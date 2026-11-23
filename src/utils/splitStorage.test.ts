import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getSavedRecipients,
  removeSavedRecipient,
  saveRecipient,
  getTemplates,
  saveTemplate,
  getHistory,
  addHistoryEntry,
} from './splitStorage'

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size
    },
  } satisfies Storage)
})

describe('split storage account and network separation', () => {
  it('isolates saved recipients by account and chain', () => {
    saveRecipient('0xAAA', 5042, { name: 'Alice', address: '0x1111111111111111111111111111111111111111' })
    saveRecipient('0xBBB', 5042, { name: 'Bob', address: '0x2222222222222222222222222222222222222222' })
    saveRecipient('0xAAA', 5042002, { name: 'Test Alice', address: '0x3333333333333333333333333333333333333333' })

    expect(getSavedRecipients('0xaaa', 5042)).toHaveLength(1)
    expect(getSavedRecipients('0xbbb', 5042)).toHaveLength(1)
    expect(getSavedRecipients('0xaaa', 5042002)).toHaveLength(1)

    const mainnetRecipient = getSavedRecipients('0xaaa', 5042)[0]
    expect(mainnetRecipient.address).toBe('0x1111111111111111111111111111111111111111')
  })

  it('removes only the requested saved recipient', () => {
    saveRecipient('0xAAA', 5042, { name: 'Alice', address: '0x1111111111111111111111111111111111111111' })
    saveRecipient('0xAAA', 5042, { name: 'Bob', address: '0x2222222222222222222222222222222222222222' })
    const bob = getSavedRecipients('0xAAA', 5042).find((recipient) => recipient.name === 'Bob')
    expect(bob).toBeTruthy()

    removeSavedRecipient('0xAAA', 5042, bob!.id)
    expect(getSavedRecipients('0xAAA', 5042)).toHaveLength(1)
  })

  it('stores templates and history under the active account and network', () => {
    const recipient = { id: 'r1', address: '0x1111111111111111111111111111111111111111', amountRaw: 2_000_000n }
    saveTemplate('0xAAA', 5042, 'Team', [recipient])
    addHistoryEntry('0xAAA', 5042, {
      txHash: `0x${'a'.repeat(64)}`,
      chainId: 5042,
      status: 'success',
      mode: 'fixed',
      totalRaw: '2000000',
      recipients: [{ address: recipient.address, amountRaw: '2000000' }],
    })

    expect(getTemplates('0xAAA', 5042)).toHaveLength(1)
    expect(getTemplates('0xAAA', 5042)[0]).toMatchObject({
      mode: 'fixed',
      recipients: [{ address: recipient.address, amountRaw: '2000000' }],
    })
    expect(getTemplates('0xAAA', 5042002)).toHaveLength(0)
    expect(getHistory('0xAAA', 5042)).toHaveLength(1)
    expect(getHistory('0xBBB', 5042)).toHaveLength(0)
  })

  it('preserves existing percentage history records without requiring percentage UI', () => {
    addHistoryEntry('0xAAA', 5042002, {
      txHash: `0x${'b'.repeat(64)}`,
      chainId: 5042002,
      status: 'success',
      mode: 'percentage',
      totalRaw: '2000000',
      recipients: [{ address: '0x1111111111111111111111111111111111111111', amountRaw: '1000000' }],
    })

    expect(getHistory('0xAAA', 5042002)[0]).toMatchObject({
      mode: 'percentage',
      totalRaw: '2000000',
      recipients: [{ amountRaw: '1000000' }],
    })
  })

  it('does not duplicate history when a confirmed receipt is recovered more than once', () => {
    const entry = {
      txHash: `0x${'c'.repeat(64)}` as `0x${string}`,
      chainId: 5042,
      status: 'success' as const,
      mode: 'fixed' as const,
      totalRaw: '2000000',
      recipients: [{ address: '0x1111111111111111111111111111111111111111', amountRaw: '2000000' }],
    }

    addHistoryEntry('0xAAA', 5042, entry)
    addHistoryEntry('0xAAA', 5042, entry)

    expect(getHistory('0xAAA', 5042)).toHaveLength(1)
  })

  it('preserves legacy successful history without rewriting it as a different schema', () => {
    const key = 'arcsplit.v1.0xaaa.5042002'
    const legacyEntry = {
      id: 'legacy',
      txHash: `0x${'d'.repeat(64)}`,
      chainId: 5042002,
      mode: 'percentage',
      totalRaw: '2000000',
      recipients: [{ address: '0x1111111111111111111111111111111111111111', amountRaw: '2000000' }],
      createdAt: 1,
    }
    ;(globalThis.localStorage as Storage).setItem(key, JSON.stringify({
      recipients: [],
      templates: [],
      history: [legacyEntry],
    }))

    expect(getHistory('0xAAA', 5042002)).toEqual([legacyEntry])
    expect(JSON.parse((globalThis.localStorage as Storage).getItem(key)!).history).toEqual([legacyEntry])
  })

  it('does not evict existing history when adding additional confirmed records', () => {
    const key = 'arcsplit.v1.0xaaa.5042'
    const existing = Array.from({ length: 100 }, (_, index) => ({
      id: `existing-${index}`,
      txHash: `0x${index.toString(16).padStart(64, '0')}`,
      chainId: 5042,
      status: 'success',
      mode: 'fixed',
      totalRaw: '1000000',
      recipients: [{ address: '0x1111111111111111111111111111111111111111', amountRaw: '1000000' }],
      createdAt: index + 1,
    }))
    ;(globalThis.localStorage as Storage).setItem(key, JSON.stringify({
      recipients: [],
      templates: [],
      history: existing,
    }))

    expect(addHistoryEntry('0xAAA', 5042, {
      txHash: `0x${'e'.repeat(64)}`,
      chainId: 5042,
      status: 'failed',
      mode: 'fixed',
      totalRaw: '1000000',
      recipients: [{ address: '0x2222222222222222222222222222222222222222', amountRaw: '1000000' }],
    })).toBe(true)
    expect(getHistory('0xAAA', 5042)).toHaveLength(101)
    expect(getHistory('0xAAA', 5042).some((entry) => entry.id === 'existing-0')).toBe(true)
  })

  it('discards malformed nested storage entries', () => {
    const key = 'arcsplit.v1.0xaaa.5042'
    ;(globalThis.localStorage as Storage).setItem(key, JSON.stringify({
      recipients: [
        { id: 'good', name: 'Good', address: '0x1111111111111111111111111111111111111111', createdAt: 1 },
        { id: 'bad', name: 42, address: 'not-an-address', createdAt: 'bad' },
      ],
      templates: [
        {
          id: 'bad-template',
          name: 'Bad',
          mode: 'fixed',
          recipients: [{ address: 'not-an-address', sharesBps: 100, amountRaw: '-1' }],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      history: [
        {
          id: 'bad-history',
          txHash: '0xno',
          chainId: 5042,
          mode: 'fixed',
          totalRaw: '-1',
          recipients: [],
          createdAt: 1,
        },
        {
          id: 'out-of-range-date',
          txHash: `0x${'f'.repeat(64)}`,
          chainId: 5042,
          mode: 'fixed',
          totalRaw: '1000000',
          recipients: [{ address: '0x1111111111111111111111111111111111111111', amountRaw: '1000000' }],
          createdAt: 1e100,
        },
      ],
    }))

    expect(getSavedRecipients('0xAAA', 5042)).toEqual([
      { id: 'good', name: 'Good', address: '0x1111111111111111111111111111111111111111', createdAt: 1 },
    ])
    expect(getTemplates('0xAAA', 5042)).toEqual([])
    expect(getHistory('0xAAA', 5042)).toEqual([])
  })
})
