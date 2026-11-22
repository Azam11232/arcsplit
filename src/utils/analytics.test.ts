import { describe, expect, it } from 'vitest'
import {
  buildDailyDistributionBuckets,
  buildDailyDistributionBucketsForRange,
  calculateSplitAnalytics,
  formatAveragePayment,
  formatUtcMonthAxisLabel,
} from './analytics'
import type { SplitHistoryEntry } from './splitStorage'

function historyEntry(
  overrides: Partial<SplitHistoryEntry> & Pick<SplitHistoryEntry, 'txHash' | 'createdAt'>,
): SplitHistoryEntry {
  return {
    id: overrides.txHash,
    chainId: 5042,
    status: 'success',
    mode: 'fixed',
    totalRaw: '1000000',
    recipients: [{ address: '0x1111111111111111111111111111111111111111', amountRaw: '1000000' }],
    ...overrides,
  }
}

describe('formatAveragePayment', () => {
  it('truncates to one decimal place without rounding', () => {
    expect(formatAveragePayment(2_585_714n)).toBe('2.5 USDC')
  })

  it('formats zero and other small values with one decimal place', () => {
    expect(formatAveragePayment(0n)).toBe('0.0 USDC')
    expect(formatAveragePayment(150_000n)).toBe('0.1 USDC')
  })

  it('preserves the unavailable display when no average exists', () => {
    expect(formatAveragePayment(undefined)).toBe('—')
  })
})

describe('calculateSplitAnalytics', () => {
  it('aggregates confirmed distributions, recipients, failures, and time buckets', () => {
    const history = [
      historyEntry({
        txHash: `0x${'a'.repeat(64)}`,
        createdAt: Date.UTC(2026, 10, 18, 12),
        totalRaw: '2500000',
        recipients: [
          { address: '0x1111111111111111111111111111111111111111', amountRaw: '1500000' },
          { address: '0x2222222222222222222222222222222222222222', amountRaw: '1000000' },
        ],
      }),
      historyEntry({
        txHash: `0x${'b'.repeat(64)}`,
        createdAt: Date.UTC(2026, 10, 19, 12),
        totalRaw: '1500000',
        recipients: [
          { address: '0x1111111111111111111111111111111111111111', amountRaw: '1000000' },
          { address: '0x3333333333333333333333333333333333333333', amountRaw: '500000' },
        ],
      }),
      historyEntry({
        txHash: `0x${'c'.repeat(64)}`,
        createdAt: Date.UTC(2026, 10, 19, 13),
        status: 'failed',
        totalRaw: '9000000',
      }),
      historyEntry({
        txHash: `0x${'d'.repeat(64)}`,
        createdAt: Date.UTC(2026, 10, 19, 14),
        status: undefined,
      }),
    ]

    const analytics = calculateSplitAnalytics(history)

    expect(analytics).toMatchObject({
      successfulCount: 3,
      failedCount: 1,
      totalRaw: 5_000_000n,
      averageRaw: 1_666_666n,
      topRecipient: {
        address: '0x1111111111111111111111111111111111111111',
        totalRaw: 3_500_000n,
      },
    })
    expect(analytics.weekly).toEqual([
      { key: '2026-11-16', label: 'Nov 16 – Nov 22', totalRaw: 5_000_000n },
    ])
    expect(analytics.monthly).toEqual([
      { key: '2026-11', label: 'November 2026', totalRaw: 5_000_000n },
    ])
  })

  it('filters by inclusive calendar dates and does not double-count duplicate hashes', () => {
    const first = historyEntry({
      txHash: `0x${'a'.repeat(64)}`,
      createdAt: Date.UTC(2026, 10, 18, 23, 59),
    })
    const analytics = calculateSplitAnalytics([
      first,
      { ...first, id: 'duplicate', totalRaw: '8000000' },
      historyEntry({
        txHash: `0x${'b'.repeat(64)}`,
        createdAt: Date.UTC(2026, 10, 19),
        totalRaw: '2000000',
      }),
    ], { startDate: '2026-11-19', endDate: '2026-11-19' })

    expect(analytics.successfulCount).toBe(1)
    expect(analytics.totalRaw).toBe(2_000_000n)
  })

  it('returns no invented average or recipient when there are no successful entries', () => {
    const analytics = calculateSplitAnalytics([
      historyEntry({
        txHash: `0x${'f'.repeat(64)}`,
        createdAt: Date.UTC(2026, 10, 19),
        status: 'failed',
      }),
    ])

    expect(analytics).toMatchObject({
      successfulCount: 0,
      failedCount: 1,
      totalRaw: 0n,
      averageRaw: undefined,
      topRecipient: undefined,
      weekly: [],
      monthly: [],
    })
  })

})

describe('buildDailyDistributionBuckets', () => {
    it('creates exactly seven UTC calendar days through today and includes only their successful totals', () => {
      const history = [
        historyEntry({
          txHash: `0x${'a'.repeat(64)}`,
          createdAt: Date.UTC(2026, 10, 13, 23, 59, 59),
          totalRaw: '9000000',
        }),
        historyEntry({
          txHash: `0x${'b'.repeat(64)}`,
          createdAt: Date.UTC(2026, 10, 14),
          totalRaw: '1000000',
        }),
        historyEntry({
          txHash: `0x${'b'.repeat(64)}`,
          createdAt: Date.UTC(2026, 10, 14),
          totalRaw: '8000000',
        }),
        historyEntry({
          txHash: `0x${'c'.repeat(64)}`,
          createdAt: Date.UTC(2026, 10, 20, 23, 59, 59),
          totalRaw: '2000000',
        }),
        historyEntry({
          txHash: `0x${'d'.repeat(64)}`,
          createdAt: Date.UTC(2026, 10, 21),
          totalRaw: '8000000',
        }),
        historyEntry({
          txHash: `0x${'e'.repeat(64)}`,
          createdAt: Date.UTC(2026, 10, 20, 12),
          status: 'failed',
          totalRaw: '7000000',
        }),
      ]

      const buckets = buildDailyDistributionBuckets(
        history,
        'week',
        Date.UTC(2026, 10, 20, 23, 59, 59),
      )

      expect(buckets).toHaveLength(7)
      expect(buckets.map(({ key }) => key)).toEqual([
        '2026-11-14',
        '2026-11-15',
        '2026-11-16',
        '2026-11-17',
        '2026-11-18',
        '2026-11-19',
        '2026-11-20',
      ])
      expect(buckets[0]).toMatchObject({ label: 'Nov 14', totalRaw: 1_000_000n })
      expect(buckets[6]?.totalRaw).toBe(2_000_000n)
      expect(buckets.reduce((sum, bucket) => sum + bucket.totalRaw, 0n)).toBe(3_000_000n)
      expect(buckets.slice(1, 6).every((bucket) => bucket.totalRaw === 0n)).toBe(true)
    })

    it('applies inclusive date filters at UTC day boundaries', () => {
      const buckets = buildDailyDistributionBuckets([
        historyEntry({
          txHash: `0x${'a'.repeat(64)}`,
          createdAt: Date.UTC(2026, 10, 14, 23, 59, 59),
          totalRaw: '1000000',
        }),
        historyEntry({
          txHash: `0x${'b'.repeat(64)}`,
          createdAt: Date.UTC(2026, 10, 15),
          totalRaw: '2000000',
        }),
      ], 'week', Date.UTC(2026, 10, 20), {
        startDate: '2026-11-14',
        endDate: '2026-11-14',
      })

      expect(buckets[0]?.totalRaw).toBe(1_000_000n)
      expect(buckets[1]?.totalRaw).toBe(0n)
      expect(buckets.reduce((sum, bucket) => sum + bucket.totalRaw, 0n)).toBe(1_000_000n)
    })

    it('aggregates every day in the current UTC month, including leap day, with consistent totals', () => {
      const buckets = buildDailyDistributionBuckets([
        historyEntry({
          txHash: `0x${'a'.repeat(64)}`,
          createdAt: Date.UTC(2024, 0, 31, 23, 59, 59),
          totalRaw: '9000000',
        }),
        historyEntry({
          txHash: `0x${'b'.repeat(64)}`,
          createdAt: Date.UTC(2024, 1, 1),
          totalRaw: '1000000',
        }),
        historyEntry({
          txHash: `0x${'c'.repeat(64)}`,
          createdAt: Date.UTC(2024, 1, 29, 23, 59, 59),
          totalRaw: '2000000',
        }),
        historyEntry({
          txHash: `0x${'d'.repeat(64)}`,
          createdAt: Date.UTC(2024, 2, 1),
          totalRaw: '8000000',
        }),
      ], 'month', Date.UTC(2024, 1, 12, 12))

      expect(buckets).toHaveLength(29)
      expect(buckets[0]).toMatchObject({ key: '2024-02-01', label: '1', totalRaw: 1_000_000n })
      expect(buckets[28]).toMatchObject({ key: '2024-02-29', label: '29', totalRaw: 2_000_000n })
      expect(buckets.reduce((sum, bucket) => sum + bucket.totalRaw, 0n)).toBe(3_000_000n)
    })

    it('keeps every zero-activity day visible for the full calendar month', () => {
      const buckets = buildDailyDistributionBuckets([], 'month', Date.UTC(2026, 10, 20))
      const thirtyOneDayMonth = buildDailyDistributionBuckets([], 'month', Date.UTC(2026, 6, 1))
      const february = buildDailyDistributionBuckets([], 'month', Date.UTC(2026, 1, 1))

      expect(buckets).toHaveLength(30)
      expect(buckets[0]?.key).toBe('2026-11-01')
      expect(buckets[29]?.key).toBe('2026-11-30')
      expect(buckets.every((bucket) => bucket.totalRaw === 0n)).toBe(true)
      expect(thirtyOneDayMonth).toHaveLength(31)
      expect(february).toHaveLength(28)
    })
})

describe('buildDailyDistributionBucketsForRange', () => {
  it('creates daily buckets across a multi-month custom range and matches filtered summary totals', () => {
    const history = [
      historyEntry({
        txHash: `0x${'a'.repeat(64)}`,
        createdAt: Date.UTC(2026, 9, 31, 23, 59, 59),
        totalRaw: '1000000',
      }),
      historyEntry({
        txHash: `0x${'b'.repeat(64)}`,
        createdAt: Date.UTC(2026, 10, 1, 12),
        totalRaw: '2000000',
      }),
      historyEntry({
        txHash: `0x${'c'.repeat(64)}`,
        createdAt: Date.UTC(2026, 10, 2),
        totalRaw: '4000000',
      }),
    ]
    const range = { startDate: '2026-10-31', endDate: '2026-11-01' }
    const buckets = buildDailyDistributionBucketsForRange(history, range, Date.UTC(2026, 10, 21))
    const analytics = calculateSplitAnalytics(history, range)

    expect(buckets.map(({ key, label, totalRaw }) => ({ key, label, totalRaw }))).toEqual([
      { key: '2026-10-31', label: '31', totalRaw: 1_000_000n },
      { key: '2026-11-01', label: 'Nov 1', totalRaw: 2_000_000n },
    ])
    expect(buckets.reduce((sum, bucket) => sum + bucket.totalRaw, 0n)).toBe(analytics.totalRaw)
    expect(analytics.totalRaw).toBe(3_000_000n)
  })
})

describe('calculateSplitAnalytics', () => {
  it('keeps charts to the most recent 12 buckets without dropping total history', () => {
    const history = Array.from({ length: 15 }, (_, index) => historyEntry({
      txHash: `0x${index.toString(16).padStart(64, '0')}`,
      createdAt: Date.UTC(2025, index, 15),
    }))
    const analytics = calculateSplitAnalytics(history)

    expect(analytics.totalRaw).toBe(15_000_000n)
    expect(analytics.monthly).toHaveLength(12)
    expect(analytics.monthly[0]?.key).toBe('2025-04')
  })

  it('fills only gaps between saved activity with explicit zero-total periods', () => {
    const analytics = calculateSplitAnalytics([
      historyEntry({
        txHash: `0x${'a'.repeat(64)}`,
        createdAt: Date.UTC(2026, 0, 15),
      }),
      historyEntry({
        txHash: `0x${'b'.repeat(64)}`,
        createdAt: Date.UTC(2026, 2, 15),
      }),
    ])

    expect(analytics.monthly).toEqual([
      { key: '2026-01', label: 'January 2026', totalRaw: 1_000_000n },
      { key: '2026-02', label: 'February 2026', totalRaw: 0n },
      { key: '2026-03', label: 'March 2026', totalRaw: 1_000_000n },
    ])
  })

  it('uses UTC Monday boundaries and readable date ranges across year transitions', () => {
    const september = calculateSplitAnalytics([
      historyEntry({
        txHash: `0x${'a'.repeat(64)}`,
        createdAt: Date.UTC(2026, 8, 6, 23, 59),
        totalRaw: '1000000',
      }),
      historyEntry({
        txHash: `0x${'b'.repeat(64)}`,
        createdAt: Date.UTC(2026, 8, 7),
        totalRaw: '2000000',
      }),
    ])
    const newYear = calculateSplitAnalytics([
      historyEntry({
        txHash: `0x${'c'.repeat(64)}`,
        createdAt: Date.UTC(2027, 0, 1),
        totalRaw: '3000000',
      }),
    ])

    expect(september.weekly).toEqual([
      { key: '2026-08-31', label: 'Aug 31 – Sep 6', totalRaw: 1_000_000n },
      { key: '2026-09-07', label: 'Sep 7 – Sep 13', totalRaw: 2_000_000n },
    ])
    expect(newYear.weekly[0]).toEqual({
      key: '2026-12-28',
      label: 'Dec 28, 2026 – Jan 3, 2027',
      totalRaw: 3_000_000n,
    })
    expect(newYear.monthly[0]).toEqual({
      key: '2027-01',
      label: 'January 2027',
      totalRaw: 3_000_000n,
    })
    expect(formatUtcMonthAxisLabel('2026-12', '2026-11')).toBe('Dec')
    expect(formatUtcMonthAxisLabel('2027-01', '2026-12')).toBe("Jan '27")
  })

  it('rejects reversed date ranges', () => {
    expect(() => calculateSplitAnalytics([], {
      startDate: '2026-11-20',
      endDate: '2026-11-19',
    })).toThrow(/on or before/i)
  })
})
