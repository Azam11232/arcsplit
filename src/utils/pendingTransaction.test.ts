import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingTransactionRecord } from './pendingTransaction'
import {
  clearPendingTransaction,
  getPendingTransaction,
  savePendingTransaction,
} from './pendingTransaction'

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
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

describe('pending transaction recovery', () => {
  const account = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const transaction: PendingTransactionRecord = {
    kind: 'distribution' as const,
    txHash: `0x${'a'.repeat(64)}`,
    amountRaw: '1500000',
    contractAddress: '0x4444444444444444444444444444444444444444',
    recipients: [
      { address: '0x1111111111111111111111111111111111111111', amountRaw: '1000000' },
      { address: '0x2222222222222222222222222222222222222222', amountRaw: '500000' },
    ],
  }

  it('restores only the pending transaction for the active account and chain', () => {
    expect(savePendingTransaction(account, 5042, transaction)).toBe(true)

    expect(getPendingTransaction(account, 5042, transaction.contractAddress)).toEqual(transaction)
    expect(getPendingTransaction(account, 5042002, transaction.contractAddress)).toBeUndefined()
    expect(getPendingTransaction('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 5042, transaction.contractAddress))
      .toBeUndefined()
  })

  it('clears the recovered transaction after it reaches a final receipt state', () => {
    savePendingTransaction(account, 5042, transaction)

    expect(clearPendingTransaction(account, 5042, transaction.contractAddress)).toBe(true)
    expect(getPendingTransaction(account, 5042, transaction.contractAddress)).toBeUndefined()
  })

  it('recovers approvals only for the spender they were submitted to', () => {
    const approval: PendingTransactionRecord = {
      kind: 'approval' as const,
      txHash: `0x${'b'.repeat(64)}`,
      amountRaw: '2000000',
      contractAddress: '0x5555555555555555555555555555555555555555',
      recipients: transaction.recipients,
    }
    expect(savePendingTransaction(account, 5042, approval)).toBe(true)
    expect(getPendingTransaction(account, 5042, approval.contractAddress)).toEqual(approval)
    expect(getPendingTransaction(account, 5042, transaction.contractAddress)).toBeUndefined()
  })

  it('keeps pending transactions isolated by contract target', () => {
    const newTarget: `0x${string}` = '0x6666666666666666666666666666666666666666'
    const nextTransaction: PendingTransactionRecord = {
      ...transaction,
      txHash: `0x${'d'.repeat(64)}`,
      contractAddress: newTarget,
    }
    expect(savePendingTransaction(account, 5042, transaction)).toBe(true)
    expect(savePendingTransaction(account, 5042, nextTransaction)).toBe(true)

    expect(getPendingTransaction(account, 5042, transaction.contractAddress)).toEqual(transaction)
    expect(getPendingTransaction(account, 5042, newTarget)).toEqual(nextTransaction)
    expect(clearPendingTransaction(account, 5042, newTarget)).toBe(true)
    expect(getPendingTransaction(account, 5042, newTarget)).toBeUndefined()
    expect(getPendingTransaction(account, 5042, transaction.contractAddress)).toEqual(transaction)
  })

  it('rejects malformed or unsafe transaction data', () => {
    const key = `arcsplit.pending.v2.0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.5042.${transaction.contractAddress}`
    ;globalThis.sessionStorage.setItem(key, JSON.stringify({
      ...transaction,
      txHash: '0xno',
    }))

    expect(getPendingTransaction(account, 5042, transaction.contractAddress)).toBeUndefined()
  })

  it('ignores legacy approvals without a recorded spender', () => {
    const key = 'arcsplit.pending.v1.0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.5042'
    ;globalThis.sessionStorage.setItem(key, JSON.stringify({
      kind: 'approval',
      txHash: `0x${'c'.repeat(64)}`,
      amountRaw: '2000000',
      recipients: transaction.recipients,
    }))

    expect(getPendingTransaction(account, 5042, transaction.contractAddress)).toBeUndefined()
  })
})
