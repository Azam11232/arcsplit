import { USDC_DECIMALS } from '@/onchain-facts'
import { formatUnitsFixed } from '@/onchain-money'

export interface AnalyticsDateRange {
  startDate?: string
  endDate?: string
}

export interface AnalyticsEntry {
  txHash: string
  logIndex?: number
  status?: 'success' | 'failed'
  verificationStatus?: 'receipt-verified' | 'unverified'
  totalRaw: string
  recipients: Array<{ address: string; amountRaw: string }>
  createdAt: number
}

export interface DistributionBucket {
  key: string
  label: string
  totalRaw: bigint
}

function isReceiptVerifiedAnalyticsEntry(entry: AnalyticsEntry): boolean {
  return entry.verificationStatus === 'receipt-verified'
}

function isVerifiedAnalyticsEntry(entry: AnalyticsEntry): boolean {
  return entry.status !== 'failed' && isReceiptVerifiedAnalyticsEntry(entry)
}

function addUniqueAnalyticsEntry(
  uniqueEntries: Map<string, AnalyticsEntry>,
  entry: AnalyticsEntry,
): void {
  const key = entry.logIndex === undefined
    ? entry.txHash.toLowerCase()
    : `${entry.txHash.toLowerCase()}:${entry.logIndex}`
  const existing = uniqueEntries.get(key)
  if (!existing
    || (existing.verificationStatus === 'unverified' && entry.verificationStatus !== 'unverified')
  ) {
    uniqueEntries.set(key, entry)
  }
}

export interface SplitAnalytics {
  successfulCount: number
  failedCount: number
  totalRaw: bigint
  averageRaw: bigint | undefined
  topRecipient: { address: string; totalRaw: bigint } | undefined
  weekly: DistributionBucket[]
  monthly: DistributionBucket[]
}

export function formatAveragePayment(raw: bigint | undefined): string {
  if (raw === undefined) return '—'
  return `${formatUnitsFixed(raw, USDC_DECIMALS, 1)} USDC`
}

function parseBoundary(value: string | undefined, field: string): number | undefined {
  if (!value) return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid analytics ${field} date.`)
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid analytics ${field} date.`)
  }
  return timestamp
}

function getRangeBounds(range: AnalyticsDateRange): { start: number | undefined; end: number | undefined } {
  const start = parseBoundary(range.startDate, 'start')
  const endDate = parseBoundary(range.endDate, 'end')
  const end = endDate === undefined ? undefined : endDate + 86_400_000
  if (start !== undefined && end !== undefined && start >= end) {
    throw new Error('Analytics start date must be on or before the end date.')
  }
  return { start, end }
}

function formatUtcDate(timestamp: number, includeYear: boolean): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  })
}

export function formatUtcWeekRange(weekStart: string): string {
  const start = parseBoundary(weekStart, 'week')
  if (start === undefined) throw new Error('Invalid analytics week date.')
  const end = start + 6 * 86_400_000
  const spansYears = new Date(start).getUTCFullYear() !== new Date(end).getUTCFullYear()
  return `${formatUtcDate(start, spansYears)} – ${formatUtcDate(end, spansYears)}`
}

export function formatUtcMonthLabel(month: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error('Invalid analytics month.')
  }
  const timestamp = Date.parse(`${month}-01T00:00:00.000Z`)
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function formatUtcDayLabel(day: string, includeYear = true): string {
  const timestamp = parseBoundary(day, 'day')
  if (timestamp === undefined) throw new Error('Invalid analytics day.')
  return formatUtcDate(timestamp, includeYear)
}

export function formatUtcMonthAxisLabel(month: string, previousMonth?: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error('Invalid analytics month.')
  }
  const monthName = new Date(`${month}-01T00:00:00.000Z`).toLocaleDateString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  })
  return !previousMonth || previousMonth.slice(0, 4) !== month.slice(0, 4)
    ? `${monthName} '${month.slice(2, 4)}`
    : monthName
}

function createBucket(
  buckets: Map<string, DistributionBucket>,
  key: string,
  label: string,
  amountRaw: bigint,
) {
  const bucket = buckets.get(key)
  if (bucket) {
    bucket.totalRaw += amountRaw
  } else {
    buckets.set(key, { key, label, totalRaw: amountRaw })
  }
}

function bucketByWeek(entries: AnalyticsEntry[]): DistributionBucket[] {
  const buckets = new Map<string, DistributionBucket>()
  for (const entry of entries.filter(isVerifiedAnalyticsEntry)) {
    const date = new Date(entry.createdAt)
    const day = (date.getUTCDay() + 6) % 7
    date.setUTCDate(date.getUTCDate() - day)
    const key = date.toISOString().slice(0, 10)
    createBucket(buckets, key, formatUtcWeekRange(key), BigInt(entry.totalRaw))
  }
  return fillRecentBuckets([...buckets.values()], 'week')
}

function bucketByMonth(entries: AnalyticsEntry[]): DistributionBucket[] {
  const buckets = new Map<string, DistributionBucket>()
  for (const entry of entries.filter(isVerifiedAnalyticsEntry)) {
    const key = new Date(entry.createdAt).toISOString().slice(0, 7)
    createBucket(buckets, key, formatUtcMonthLabel(key), BigInt(entry.totalRaw))
  }
  return fillRecentBuckets([...buckets.values()], 'month')
}

function fillRecentBuckets(
  buckets: DistributionBucket[],
  period: 'week' | 'month',
): DistributionBucket[] {
  if (buckets.length === 0) return []

  const sorted = [...buckets].sort((a, b) => a.key.localeCompare(b.key))
  const active = new Map(sorted.map((bucket) => [bucket.key, bucket]))
  const latest = new Date(`${sorted[sorted.length - 1]!.key}${period === 'week' ? 'T00:00:00.000Z' : '-01T00:00:00.000Z'}`)
  const earliest = new Date(`${sorted[0]!.key}${period === 'week' ? 'T00:00:00.000Z' : '-01T00:00:00.000Z'}`)
  const windowStart = new Date(latest)
  if (period === 'week') {
    windowStart.setUTCDate(windowStart.getUTCDate() - 7 * 11)
  } else {
    windowStart.setUTCMonth(windowStart.getUTCMonth() - 11)
  }
  const start = earliest > windowStart ? earliest : windowStart
  const result: DistributionBucket[] = []

  for (const date = new Date(start); date <= latest;) {
    const key = period === 'week'
      ? date.toISOString().slice(0, 10)
      : date.toISOString().slice(0, 7)
    result.push(active.get(key) ?? {
      key,
      label: period === 'week' ? formatUtcWeekRange(key) : formatUtcMonthLabel(key),
      totalRaw: 0n,
    })
    if (period === 'week') {
      date.setUTCDate(date.getUTCDate() + 7)
    } else {
      date.setUTCMonth(date.getUTCMonth() + 1)
    }
  }
  return result
}

export function buildDailyDistributionBuckets(
  history: AnalyticsEntry[],
  period: 'week' | 'month',
  now = Date.now(),
  range: AnalyticsDateRange = {},
): DistributionBucket[] {
  if (!Number.isFinite(now)) throw new Error('Invalid analytics reference date.')
  const rangeBounds = getRangeBounds(range)

  const today = new Date(now)
  today.setUTCHours(0, 0, 0, 0)
  const start = new Date(today)
  if (period === 'week') {
    start.setUTCDate(start.getUTCDate() - 6)
  } else {
    start.setUTCDate(1)
  }
  const end = new Date(today)
  if (period === 'week') {
    end.setUTCDate(end.getUTCDate() + 1)
  } else {
    end.setUTCDate(1)
    end.setUTCMonth(end.getUTCMonth() + 1)
  }

  const buckets = new Map<string, DistributionBucket>()
  for (const date = new Date(start); date < end; date.setUTCDate(date.getUTCDate() + 1)) {
    const key = date.toISOString().slice(0, 10)
    buckets.set(key, {
      key,
      label: period === 'week' ? formatUtcDayLabel(key, false) : String(date.getUTCDate()),
      totalRaw: 0n,
    })
  }

  const uniqueEntries = new Map<string, AnalyticsEntry>()
  for (const entry of history) {
    addUniqueAnalyticsEntry(uniqueEntries, entry)
  }

  for (const entry of uniqueEntries.values()) {
    if (!isVerifiedAnalyticsEntry(entry)) continue
    const timestamp = new Date(entry.createdAt)
    if (!Number.isFinite(timestamp.getTime())) throw new Error('Invalid analytics entry timestamp.')
    if (timestamp < start || timestamp >= end) continue
    if (rangeBounds.start !== undefined && timestamp.getTime() < rangeBounds.start) continue
    if (rangeBounds.end !== undefined && timestamp.getTime() >= rangeBounds.end) continue

    const key = timestamp.toISOString().slice(0, 10)
    const bucket = buckets.get(key)
    if (bucket) bucket.totalRaw += BigInt(entry.totalRaw)
  }

  return [...buckets.values()]
}

export function buildDailyDistributionBucketsForRange(
  history: AnalyticsEntry[],
  range: AnalyticsDateRange = {},
  now = Date.now(),
): DistributionBucket[] {
  if (!Number.isFinite(now)) throw new Error('Invalid analytics reference date.')
  const rangeBounds = getRangeBounds(range)
  const uniqueEntries = new Map<string, AnalyticsEntry>()
  for (const entry of history) {
    addUniqueAnalyticsEntry(uniqueEntries, entry)
  }

  const entries = [...uniqueEntries.values()]
    .filter(isVerifiedAnalyticsEntry)
    .map((entry) => {
      const timestamp = new Date(entry.createdAt)
      if (!Number.isFinite(timestamp.getTime())) throw new Error('Invalid analytics entry timestamp.')
      return { entry, timestamp }
    })
    .filter(({ timestamp }) =>
      (rangeBounds.start === undefined || timestamp.getTime() >= rangeBounds.start)
      && (rangeBounds.end === undefined || timestamp.getTime() < rangeBounds.end),
    )

  const dayMs = 86_400_000
  const entryDayBounds = entries.reduce((bounds, { timestamp }) => {
    const day = new Date(timestamp)
    day.setUTCHours(0, 0, 0, 0)
    return {
      start: Math.min(bounds.start, day.getTime()),
      end: Math.max(bounds.end, day.getTime()),
    }
  }, { start: Number.POSITIVE_INFINITY, end: Number.NEGATIVE_INFINITY })
  const start = rangeBounds.start
    ?? (entries.length
      ? entryDayBounds.start
      : rangeBounds.end === undefined ? undefined : rangeBounds.end - dayMs)
  const today = new Date(now)
  today.setUTCHours(0, 0, 0, 0)
  const end = rangeBounds.end
    ?? (start === undefined
      ? entries.length ? Math.max(today.getTime(), entryDayBounds.end) + dayMs : undefined
      : entries.length ? Math.max(today.getTime(), entryDayBounds.end) + dayMs : Math.max(today.getTime(), start) + dayMs)

  if (start === undefined || end === undefined || start >= end) return []

  const buckets = new Map<string, DistributionBucket>()
  for (let day = start; day < end; day += dayMs) {
    const key = new Date(day).toISOString().slice(0, 10)
    const date = new Date(day)
    buckets.set(key, {
      key,
      label: date.getUTCDate() === 1 ? formatUtcDayLabel(key, false) : String(date.getUTCDate()),
      totalRaw: 0n,
    })
  }

  for (const { entry, timestamp } of entries) {
    const key = timestamp.toISOString().slice(0, 10)
    const bucket = buckets.get(key)
    if (bucket) bucket.totalRaw += BigInt(entry.totalRaw)
  }

  return [...buckets.values()]
}

export function calculateSplitAnalytics(
  history: AnalyticsEntry[],
  range: AnalyticsDateRange = {},
): SplitAnalytics {
  const { start, end } = getRangeBounds(range)

  const uniqueEntries = new Map<string, AnalyticsEntry>()
  for (const entry of history) {
    addUniqueAnalyticsEntry(uniqueEntries, entry)
  }

  const filtered = [...uniqueEntries.values()].filter((entry) =>
    isReceiptVerifiedAnalyticsEntry(entry)
    && (start === undefined || entry.createdAt >= start)
    && (end === undefined || entry.createdAt < end),
  )
  const successful = filtered.filter((entry) => entry.status !== 'failed')
  const failedCount = filtered.length - successful.length
  const totalRaw = successful.reduce((total, entry) => total + BigInt(entry.totalRaw), 0n)
  const recipientTotals = new Map<string, { address: string; totalRaw: bigint }>()

  for (const entry of successful) {
    for (const recipient of entry.recipients) {
      const key = recipient.address.toLowerCase()
      const current = recipientTotals.get(key)
      if (current) {
        current.totalRaw += BigInt(recipient.amountRaw)
      } else {
        recipientTotals.set(key, {
          address: recipient.address,
          totalRaw: BigInt(recipient.amountRaw),
        })
      }
    }
  }

  const topRecipient = [...recipientTotals.values()].sort((a, b) =>
    a.totalRaw === b.totalRaw
      ? a.address.toLowerCase().localeCompare(b.address.toLowerCase())
      : a.totalRaw > b.totalRaw ? -1 : 1,
  )[0]

  return {
    successfulCount: successful.length,
    failedCount,
    totalRaw,
    averageRaw: successful.length > 0 ? totalRaw / BigInt(successful.length) : undefined,
    topRecipient,
    weekly: bucketByWeek(successful),
    monthly: bucketByMonth(successful),
  }
}
