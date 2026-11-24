import {
  decodeEventLog,
  getAddress,
  isAddress,
  parseAbiItem,
  toEventSelector,
} from 'viem'
import type { Address, Hash, Hex, PublicClient } from 'viem'
import { getArcNetwork } from './arcsplit'
import type { SplitHistoryEntry } from './splitStorage'
import { redactTelemetryText } from './telemetrySecurity'

const distributedEvent = parseAbiItem(
  'event Distributed(address indexed payer, uint256 totalAmount, uint256 recipientCount)',
)
const recipientPayoutEvent = parseAbiItem(
  'event RecipientPayout(address indexed recipient, uint256 amount)',
)
const distributedTopic = toEventSelector(distributedEvent)
const recipientPayoutTopic = toEventSelector(recipientPayoutEvent)

const LOG_BLOCK_RANGE = 10_000n
const RECEIPT_CONCURRENCY = 4
const RPC_MAX_CONCURRENT_REQUESTS = 4
const RPC_TIMEOUT_MS = 12_000
const RPC_RETRY_BASE_DELAY_MS = 250
const RPC_RETRY_MAX_DELAY_MS = 8_000
const RPC_RETRY_AFTER_MAX_MS = 60_000
const RPC_MAX_ATTEMPTS = 4
const CACHE_VERSION = 2
const CACHE_PREFIX = 'arcsplit:onchain-analytics'

type EventLog = {
  address: Address
  blockNumber: bigint | null
  blockHash: Hash | null
  logIndex: number | null
  removed?: boolean
  transactionHash: Hash | null
  data: Hex
  topics: [Hex, ...Hex[]]
}

type ReceiptLog = {
  address: Address
  data: Hex
  logIndex: number
  topics: readonly Hex[]
}

type ReceiptForVerification = {
  blockNumber: bigint
  blockHash: Hash
  logs: readonly ReceiptLog[]
  status: 'success' | 'reverted'
  to: Address | null
  transactionHash: Hash
}

export interface OnchainDistributionRecord {
  id: string
  chainId: number
  contractAddress: Address
  networkName: string
  payer: Address
  txHash: Hash
  blockNumber: bigint
  blockHash: Hash
  logIndex: number
  createdAt: number
  totalRaw: string
  recipients: Array<{ address: Address; amountRaw: string }>
  status: 'success'
  verificationStatus: 'receipt-verified' | 'unverified'
}

export interface OnchainScanProgress {
  phase: 'discovering' | 'revalidating' | 'scanning' | 'verifying'
  fromBlock?: bigint
  toBlock?: bigint
  blocksScanned: bigint
  totalBlocks: bigint
  receiptsChecked: number
  totalReceipts: number
}

export interface OnchainScanResult {
  records: OnchainDistributionRecord[]
  coverage: {
    deploymentBlock: bigint
    deploymentTimestamp?: number
    scannedThroughBlock: bigint
    scannedThroughHash?: Hash
    contracts?: Array<{
      contractAddress: Address
      deploymentBlock: bigint
      deploymentTimestamp?: number
      scannedThroughBlock: bigint
    }>
    expectedContractCount?: number
  }
  cacheWarning?: string
}

export interface OnchainScanOptions {
  chainId: number
  networkName: string
  contractAddress: Address
  payer: Address
  forceRescan?: boolean
  onProgress?: (progress: OnchainScanProgress) => void
}

interface WalletScanCache {
  deploymentBlock: bigint
  deploymentTimestamp?: number
  scannedThroughBlock: bigint
  scannedThroughHash: Hash
  records: OnchainDistributionRecord[]
}

export interface OnchainCacheReadResult {
  snapshot?: OnchainScanResult
  warning?: string
}

class CachedRecordVerificationError extends Error {}

const liveVerifiedDistributionRecords = new WeakSet<object>()

export function isLiveVerifiedDistributionRecord(record: OnchainDistributionRecord): boolean {
  return liveVerifiedDistributionRecords.has(record)
}

function markLiveVerifiedDistributionRecord(record: OnchainDistributionRecord): OnchainDistributionRecord {
  liveVerifiedDistributionRecords.add(record)
  return record
}

const deploymentBlocks = new Map<string, bigint>()
const scanCaches = new Map<string, WalletScanCache>()
let activeRpcRequests = 0
const queuedRpcRequests: Array<() => void> = []
const scanJobs = new Map<string, {
  promise: Promise<OnchainScanResult>
  listeners: Set<(progress: OnchainScanProgress) => void>
  forceRescan: boolean
}>()

function normalizedAddress(address: string): string {
  return address.toLowerCase()
}

function isHash(value: unknown): value is Hash {
  return typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value)
}

function isDecimal(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value)
}

function cacheKey(options: Pick<OnchainScanOptions, 'chainId' | 'contractAddress' | 'payer'>): string {
  return `${CACHE_PREFIX}:v${CACHE_VERSION}:${options.chainId}:${normalizedAddress(options.contractAddress)}:${normalizedAddress(options.payer)}`
}

function browserStorage(): Storage | undefined {
  try {
    return typeof globalThis.localStorage === 'undefined' ? undefined : globalThis.localStorage
  } catch {
    return undefined
  }
}

function validateCachedRecord(
  value: unknown,
  context: Pick<OnchainScanOptions, 'chainId' | 'contractAddress' | 'networkName' | 'payer'>,
  deploymentBlock: bigint,
  scannedThroughBlock: bigint,
): OnchainDistributionRecord | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (
    record.chainId !== context.chainId
    || typeof record.contractAddress !== 'string'
    || normalizedAddress(record.contractAddress) !== normalizedAddress(context.contractAddress)
    || typeof record.payer !== 'string'
    || normalizedAddress(record.payer) !== normalizedAddress(context.payer)
    || typeof record.txHash !== 'string'
    || !isHash(record.txHash)
    || !isHash(record.blockHash)
    || !isDecimal(record.blockNumber)
    || !isDecimal(record.totalRaw)
    || typeof record.logIndex !== 'number'
    || !Number.isSafeInteger(record.logIndex)
    || record.logIndex < 0
    || typeof record.createdAt !== 'number'
    || !Number.isSafeInteger(record.createdAt)
    || record.createdAt <= 0
    || record.status !== 'success'
    || !Array.isArray(record.recipients)
  ) return undefined

  const blockNumber = BigInt(record.blockNumber)
  const totalRaw = BigInt(record.totalRaw)
  if (blockNumber < deploymentBlock || blockNumber > scannedThroughBlock || totalRaw <= 0n) return undefined
  if (record.recipients.length === 0 || record.recipients.length > 50) return undefined

  let payoutTotal = 0n
  const recipients: Array<{ address: Address; amountRaw: string }> = []
  const seenRecipients = new Set<string>()
  for (const recipientValue of record.recipients) {
    if (!recipientValue || typeof recipientValue !== 'object') return undefined
    const recipient = recipientValue as Record<string, unknown>
    if (
      typeof recipient.address !== 'string'
      || !isAddress(recipient.address)
      || !isDecimal(recipient.amountRaw)
      || BigInt(recipient.amountRaw) <= 0n
      || seenRecipients.has(normalizedAddress(recipient.address))
    ) return undefined
    seenRecipients.add(normalizedAddress(recipient.address))
    payoutTotal += BigInt(recipient.amountRaw)
    recipients.push({
      address: getAddress(recipient.address),
      amountRaw: recipient.amountRaw,
    })
  }
  if (payoutTotal !== totalRaw) return undefined

  const txHash = record.txHash as Hash
  const id = `${context.chainId}:${txHash.toLowerCase()}:${record.logIndex}`
  if (record.id !== id) return undefined

  return {
    id,
    chainId: context.chainId,
    contractAddress: getAddress(context.contractAddress),
    networkName: context.networkName,
    payer: getAddress(context.payer),
    txHash,
    blockNumber,
    blockHash: record.blockHash,
    logIndex: record.logIndex,
    createdAt: record.createdAt,
    totalRaw: record.totalRaw,
    recipients,
    status: 'success',
    verificationStatus: 'unverified',
  }
}

export function readOnchainScanCache(
  options: Pick<OnchainScanOptions, 'chainId' | 'contractAddress' | 'networkName' | 'payer'>,
  storage: Storage | undefined = browserStorage(),
): OnchainCacheReadResult {
  if (!storage) return { warning: 'Browser storage is unavailable; this scan cannot be cached.' }

  const key = cacheKey(options)
  let serialized: string | null
  try {
    serialized = storage.getItem(key)
  } catch {
    return { warning: 'Browser storage could not be read; a fresh scan will be performed.' }
  }
  if (serialized === null) return {}

  try {
    const cached: unknown = JSON.parse(serialized)
    if (!cached || typeof cached !== 'object') throw new Error('Invalid cache envelope.')
    const envelope = cached as Record<string, unknown>
    if (
      envelope.version !== CACHE_VERSION
      || envelope.complete !== true
      || envelope.chainId !== options.chainId
      || typeof envelope.contractAddress !== 'string'
      || normalizedAddress(envelope.contractAddress) !== normalizedAddress(options.contractAddress)
      || typeof envelope.payer !== 'string'
      || normalizedAddress(envelope.payer) !== normalizedAddress(options.payer)
      || !isDecimal(envelope.deploymentBlock)
      || !isDecimal(envelope.scannedThroughBlock)
      || !isHash(envelope.scannedThroughHash)
      || !Array.isArray(envelope.records)
    ) throw new Error('Invalid or incomplete cache checkpoint.')

    const deploymentBlock = BigInt(envelope.deploymentBlock)
    const scannedThroughBlock = BigInt(envelope.scannedThroughBlock)
    if (deploymentBlock > scannedThroughBlock) throw new Error('Invalid cache block coverage.')
    const deploymentTimestamp = envelope.deploymentTimestamp
    const validDeploymentTimestamp = typeof deploymentTimestamp === 'number'
      && Number.isSafeInteger(deploymentTimestamp)
      && deploymentTimestamp > 0
      ? deploymentTimestamp
      : undefined

    const records: OnchainDistributionRecord[] = []
    const recordIds = new Set<string>()
    for (const item of envelope.records) {
      const record = validateCachedRecord(item, options, deploymentBlock, scannedThroughBlock)
      if (!record || recordIds.has(record.id)) throw new Error('Invalid cached distribution record.')
      recordIds.add(record.id)
      records.push(record)
    }

    return {
      snapshot: {
        records,
        coverage: {
          deploymentBlock,
          ...(validDeploymentTimestamp === undefined ? {} : { deploymentTimestamp: validDeploymentTimestamp }),
          scannedThroughBlock,
          scannedThroughHash: envelope.scannedThroughHash,
        },
      },
      ...(deploymentTimestamp !== undefined && validDeploymentTimestamp === undefined
        ? { warning: 'The cached contract start date was invalid and will be re-derived during scanning.' }
        : {}),
    }
  } catch {
    try {
      storage.removeItem(key)
    } catch {
      return { warning: 'A saved analytics checkpoint was invalid and could not be cleared; a full scan will be performed.' }
    }
    return { warning: 'A saved analytics checkpoint was invalid and has been discarded; a full scan will be performed.' }
  }
}

function persistOnchainScanCache(
  options: Pick<OnchainScanOptions, 'chainId' | 'contractAddress' | 'payer'>,
  snapshot: OnchainScanResult,
): string | undefined {
  const storage = browserStorage()
  if (!storage) return 'Browser storage is unavailable; this scan will not persist between visits.'
  const { deploymentBlock, scannedThroughBlock, scannedThroughHash } = snapshot.coverage
  if (!scannedThroughHash) return 'The scan checkpoint has no verified block hash and was not cached.'

  try {
    storage.setItem(cacheKey(options), JSON.stringify({
      version: CACHE_VERSION,
      complete: true,
      chainId: options.chainId,
      contractAddress: normalizedAddress(options.contractAddress),
      payer: normalizedAddress(options.payer),
      deploymentBlock: deploymentBlock.toString(),
      ...(snapshot.coverage.deploymentTimestamp === undefined
        ? {}
        : { deploymentTimestamp: snapshot.coverage.deploymentTimestamp }),
      scannedThroughBlock: scannedThroughBlock.toString(),
      scannedThroughHash,
      records: snapshot.records.map((record) => ({
        ...record,
        blockNumber: record.blockNumber.toString(),
      })),
    }))
    return undefined
  } catch {
    return 'Browser storage could not save the verified checkpoint; future visits may require a full scan.'
  }
}

function errorText(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (current instanceof Error) {
      parts.push(current.message)
      current = 'cause' in current ? current.cause : undefined
    } else if (typeof current === 'object') {
      const record = current as Record<string, unknown>
      for (const key of ['shortMessage', 'details', 'message']) {
        if (typeof record[key] === 'string') parts.push(record[key])
      }
      current = record.cause
    } else {
      parts.push(String(current))
      break
    }
  }
  return parts.filter((part) => part.trim()).join(' | ') || 'Unknown RPC error.'
}

async function withRpcRequestLimit<T>(request: () => Promise<T>): Promise<T> {
  await new Promise<void>((resolve) => {
    if (activeRpcRequests < RPC_MAX_CONCURRENT_REQUESTS) {
      activeRpcRequests += 1
      resolve()
    } else {
      queuedRpcRequests.push(() => {
        activeRpcRequests += 1
        resolve()
      })
    }
  })

  try {
    return await request()
  } finally {
    activeRpcRequests -= 1
    queuedRpcRequests.shift()?.()
  }
}

function rpcErrorStatus(error: unknown): number | undefined {
  const visited = new Set<object>()
  let current = error

  while (typeof current === 'object' && current !== null && !visited.has(current)) {
    visited.add(current)
    const record = current as Record<string, unknown>
    if (typeof record.status === 'number') return record.status
    current = record.cause
  }

  return undefined
}

function retryAfterMilliseconds(error: unknown): number | undefined {
  const visited = new Set<object>()
  let current = error

  while (typeof current === 'object' && current !== null && !visited.has(current)) {
    visited.add(current)
    const record = current as Record<string, unknown>
    const headers = record.headers
    let value: string | null | undefined

    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
      value = headers.get('Retry-After')
    } else if (
      typeof headers === 'object'
      && headers !== null
      && 'get' in headers
      && typeof headers.get === 'function'
    ) {
      const getHeader = headers.get as (name: string) => string | null
      value = getHeader.call(headers, 'Retry-After')
    }

    if (value) {
      const seconds = Number(value.trim())
      if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000
      const retryAt = Date.parse(value)
      if (Number.isFinite(retryAt)) return Math.max(0, retryAt - Date.now())
    }

    current = record.cause
  }

  return undefined
}

function retryDelayMilliseconds(error: unknown, attempt: number): number | undefined {
  const retryAfter = retryAfterMilliseconds(error)
  if (retryAfter !== undefined && retryAfter > RPC_RETRY_AFTER_MAX_MS) return undefined

  const backoff = Math.min(
    RPC_RETRY_MAX_DELAY_MS,
    RPC_RETRY_BASE_DELAY_MS * (2 ** (attempt - 1)),
  )
  const jitteredBackoff = Math.floor(backoff * (0.5 + Math.random() * 0.5))
  return Math.max(jitteredBackoff, retryAfter ?? 0)
}

function isRateLimitError(error: unknown): boolean {
  if (rpcErrorStatus(error) === 429) return true
  const message = errorText(error).toLowerCase()
  return ['rate limit', 'too many requests', 'http 429', '429'].some((phrase) =>
    message.includes(phrase),
  )
}

function isRangeLimitError(error: unknown): boolean {
  if (isRateLimitError(error)) return false
  const message = errorText(error).toLowerCase()
  return [
    'block range',
    'range limit',
    'range too large',
    'requested range',
    'too many results',
    'response size',
    'max results',
    'maximum block',
    'limit exceeded',
  ].some((phrase) => message.includes(phrase))
}

function isTransientRpcError(error: unknown): boolean {
  const status = rpcErrorStatus(error)
  if (status !== undefined && [429, 502, 503, 504].includes(status)) return true

  const message = errorText(error).toLowerCase()
  return [
    'fetch failed',
    'failed to fetch',
    'network error',
    'network request failed',
    'connection',
    'timed out',
    'timeout',
    'rate limit',
    'too many requests',
    'temporarily unavailable',
    'service unavailable',
    'bad gateway',
    'gateway timeout',
    'connection reset',
    'connection refused',
    'socket',
    'econnreset',
    'etimedout',
    '429',
    '502',
    '503',
    '504',
    'http 429',
    'http 502',
    'http 503',
    'http 504',
  ].some((phrase) => message.includes(phrase))
}

interface RpcDiagnosticContext {
  method: string
  contractAddress: Address
  blockNumber?: bigint
  fromBlock?: bigint
  toBlock?: bigint
}

function logRpcDiagnostic(
  context: RpcDiagnosticContext,
  attempt: number,
  durationMs: number,
  error?: unknown,
  failed = false,
): void {
  if (!import.meta.env.DEV) return

  const details = {
    method: context.method,
    contractAddress: context.contractAddress,
    ...(context.blockNumber === undefined ? {} : { blockNumber: context.blockNumber.toString() }),
    ...(context.fromBlock === undefined ? {} : { fromBlock: context.fromBlock.toString() }),
    ...(context.toBlock === undefined ? {} : { toBlock: context.toBlock.toString() }),
    attempt,
    durationMs,
    ...(failed ? { error: redactTelemetryText(errorText(error)).slice(0, 300) } : {}),
  }
  if (failed) {
    console.warn('[ArcSplit analytics RPC]', details)
  } else {
    console.debug('[ArcSplit analytics RPC]', details)
  }
}

async function requestWithRetry<T>(
  operation: string,
  request: () => Promise<T>,
  diagnostics?: RpcDiagnosticContext,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= RPC_MAX_ATTEMPTS; attempt += 1) {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const startedAt = Date.now()
    try {
      const result = await withRpcRequestLimit(() => Promise.race([
        request(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`${operation} timed out after ${RPC_TIMEOUT_MS / 1_000} seconds.`)),
            RPC_TIMEOUT_MS,
          )
        }),
      ]))
      if (diagnostics) logRpcDiagnostic(diagnostics, attempt, Date.now() - startedAt)
      return result
    } catch (error) {
      lastError = error
      if (diagnostics) logRpcDiagnostic(diagnostics, attempt, Date.now() - startedAt, error, true)
      if (attempt === RPC_MAX_ATTEMPTS || isRangeLimitError(error) || !isTransientRpcError(error)) {
        throw error
      }
      const delay = retryDelayMilliseconds(error, attempt)
      if (delay === undefined) throw error
      await new Promise((resolve) => setTimeout(resolve, delay))
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
    }
  }
  throw lastError
}

export function createBlockRanges(
  fromBlock: bigint,
  toBlock: bigint,
  blockRange: bigint = LOG_BLOCK_RANGE,
): Array<{ fromBlock: bigint; toBlock: bigint }> {
  if (fromBlock < 0n || toBlock < fromBlock || blockRange < 1n) {
    throw new Error('Invalid ArcSplit block range.')
  }

  const ranges: Array<{ fromBlock: bigint; toBlock: bigint }> = []
  for (let start = fromBlock; start <= toBlock;) {
    const end = start + blockRange - 1n < toBlock
      ? start + blockRange - 1n
      : toBlock
    ranges.push({ fromBlock: start, toBlock: end })
    start = end + 1n
  }
  return ranges
}

async function findDeploymentBlock(
  client: PublicClient,
  chainId: number,
  contractAddress: Address,
  latestBlock: bigint,
): Promise<bigint> {
  const key = `${chainId}:${normalizedAddress(contractAddress)}`
  const cached = deploymentBlocks.get(key)
  if (cached !== undefined && cached <= latestBlock
    && await validateDeploymentBlockHint(client, contractAddress, cached)) {
    return cached
  }
  if (cached !== undefined) deploymentBlocks.delete(key)

  const latestCode = await requestWithRetry('Reading ArcSplit contract code', () =>
    client.getBytecode({
      address: contractAddress,
      blockNumber: latestBlock,
    }), { method: 'eth_getCode', contractAddress, blockNumber: latestBlock })
  if (!latestCode || latestCode === '0x') {
    throw new Error(`No ArcSplit contract code was found at ${contractAddress} on this network.`)
  }

  let low = 0n
  let high = latestBlock
  try {
    while (low < high) {
      const middle = (low + high) / 2n
      const code = await requestWithRetry('Checking the ArcSplit deployment block', () =>
        client.getBytecode({
          address: contractAddress,
          blockNumber: middle,
        }), { method: 'eth_getCode', contractAddress, blockNumber: middle })
      if (code && code !== '0x') high = middle
      else low = middle + 1n
    }
  } catch (error) {
    throw new Error(
      `The RPC could not read historical contract state to find the ArcSplit deployment block. ${errorText(error)}`,
    )
  }

  deploymentBlocks.set(key, low)
  return low
}

async function validateDeploymentBlockHint(
  client: PublicClient,
  contractAddress: Address,
  candidate: bigint,
): Promise<boolean> {
  const codeAtCandidate = await requestWithRetry('Validating the saved ArcSplit deployment block', () =>
    client.getBytecode({ address: contractAddress, blockNumber: candidate }),
  { method: 'eth_getCode', contractAddress, blockNumber: candidate })
  if (!codeAtCandidate || codeAtCandidate === '0x') return false
  if (candidate === 0n) return true
  const codeBeforeCandidate = await requestWithRetry('Validating the saved ArcSplit deployment block', () =>
    client.getBytecode({ address: contractAddress, blockNumber: candidate - 1n }),
  { method: 'eth_getCode', contractAddress, blockNumber: candidate - 1n })
  return !codeBeforeCandidate || codeBeforeCandidate === '0x'
}

export function verifyDistributionReceipt(
  eventLog: EventLog,
  receipt: ReceiptForVerification,
  block: { timestamp: bigint; hash: Hash },
  expectedPayer: Address,
  network: Pick<OnchainScanOptions, 'chainId' | 'contractAddress' | 'networkName'>,
): OnchainDistributionRecord {
  if (!isAddress(eventLog.address) || normalizedAddress(eventLog.address) !== normalizedAddress(network.contractAddress)) {
    throw new Error('The Distributed event came from an unexpected contract address.')
  }
  if (
    !eventLog.transactionHash
    || eventLog.blockNumber === null
    || eventLog.blockHash === null
    || eventLog.logIndex === null
  ) {
    throw new Error('The Distributed event is missing its transaction, block, or log reference.')
  }
  const eventLogIndex = eventLog.logIndex

  const distributed = decodeEventLog({
    abi: [distributedEvent],
    data: eventLog.data,
    topics: eventLog.topics,
    strict: true,
  })
  if (normalizedAddress(distributed.args.payer) !== normalizedAddress(expectedPayer)) {
    throw new Error('The Distributed event payer did not match the connected wallet.')
  }
  if (receipt.status !== 'success') {
    throw new Error(`Transaction ${eventLog.transactionHash} did not have a successful receipt.`)
  }
  if (
    receipt.transactionHash.toLowerCase() !== eventLog.transactionHash.toLowerCase()
    || receipt.blockNumber !== eventLog.blockNumber
    || receipt.blockHash.toLowerCase() !== eventLog.blockHash.toLowerCase()
    || receipt.blockHash.toLowerCase() !== block.hash.toLowerCase()
  ) {
    throw new Error(`The receipt for ${eventLog.transactionHash} did not match its canonical ArcSplit block.`)
  }
  const receiptDistributedLogs = receipt.logs.filter(
    (log) =>
      normalizedAddress(log.address) === normalizedAddress(network.contractAddress)
      && log.topics[0]?.toLowerCase() === distributedTopic.toLowerCase(),
  )
  const receiptEvent = receiptDistributedLogs.find((log) => log.logIndex === eventLogIndex)
  if (
    !receiptEvent
    || receiptEvent.data.toLowerCase() !== eventLog.data.toLowerCase()
    || receiptEvent.topics.length !== eventLog.topics.length
    || receiptEvent.topics.some((topic, index) => topic.toLowerCase() !== eventLog.topics[index]?.toLowerCase())
  ) {
    throw new Error(`The receipt for ${eventLog.transactionHash} did not contain the scanned Distributed event.`)
  }
  if (distributed.args.totalAmount <= 0n || distributed.args.recipientCount <= 0n || distributed.args.recipientCount > 50n) {
    throw new Error(`The Distributed event for ${eventLog.transactionHash} contains invalid totals.`)
  }

  const recipients: Array<{ address: Address; amountRaw: string }> = []
  const recipientSet = new Set<string>()
  const previousDistributedIndex = receiptDistributedLogs.reduce(
    (previous, log) => log.logIndex < eventLogIndex && log.logIndex > previous ? log.logIndex : previous,
    -1,
  )
  const payoutLogs = receipt.logs
    .filter((log) =>
      log.logIndex > previousDistributedIndex
      && log.logIndex < eventLogIndex
      && normalizedAddress(log.address) === normalizedAddress(network.contractAddress)
      && log.topics[0]?.toLowerCase() === recipientPayoutTopic.toLowerCase(),
    )
    .sort((first, second) => first.logIndex - second.logIndex)
  for (const log of payoutLogs) {
    if (
      normalizedAddress(log.address) !== normalizedAddress(network.contractAddress)
      || log.topics[0]?.toLowerCase() !== recipientPayoutTopic.toLowerCase()
    ) continue
    const [topic0, ...remainingTopics] = log.topics
    if (!topic0) continue
    const topics: [Hex, ...Hex[]] = [topic0, ...remainingTopics]

    const payout = decodeEventLog({
      abi: [recipientPayoutEvent],
      data: log.data,
      topics,
      strict: true,
    })
    const recipient = getAddress(payout.args.recipient)
    if (payout.args.amount <= 0n || recipientSet.has(normalizedAddress(recipient))) {
      throw new Error(`The payout events for ${eventLog.transactionHash} contain an invalid recipient.`)
    }
    recipientSet.add(normalizedAddress(recipient))
    recipients.push({ address: recipient, amountRaw: payout.args.amount.toString() })
  }

  const paidTotal = recipients.reduce((total, recipient) => total + BigInt(recipient.amountRaw), 0n)
  if (
    BigInt(recipients.length) !== distributed.args.recipientCount
    || paidTotal !== distributed.args.totalAmount
  ) {
    throw new Error(`The payout events for ${eventLog.transactionHash} did not reconcile with Distributed.`)
  }

  const createdAt = Number(block.timestamp * 1_000n)
  if (!Number.isSafeInteger(createdAt)) {
    throw new Error(`The block timestamp for ${eventLog.transactionHash} is outside the supported range.`)
  }

  return {
    id: `${network.chainId}:${eventLog.transactionHash.toLowerCase()}:${eventLog.logIndex}`,
    chainId: network.chainId,
    contractAddress: network.contractAddress,
    networkName: network.networkName,
    payer: getAddress(distributed.args.payer),
    txHash: eventLog.transactionHash,
    blockNumber: eventLog.blockNumber,
    blockHash: eventLog.blockHash,
    logIndex: eventLogIndex,
    createdAt,
    totalRaw: distributed.args.totalAmount.toString(),
    recipients,
    status: 'success',
    verificationStatus: 'receipt-verified',
  }
}

export async function verifyHistoryDistributionReceipt(
  client: PublicClient,
  entry: SplitHistoryEntry,
  expectedPayer: Address,
  networkName: string,
): Promise<OnchainDistributionRecord> {
  const savedContractAddress = entry.contractAddress
  if (entry.status === 'failed') {
    throw new Error('A PDF receipt is available only for successful distributions.')
  }
  if (!savedContractAddress || !isAddress(savedContractAddress) || !isAddress(expectedPayer)) {
    throw new Error('The saved payer or ArcSplit contract address is missing or invalid.')
  }
  const network = getArcNetwork(entry.chainId)
  if (!network) throw new Error('The saved transaction network is not supported.')
  if (!network.analyticsContractAddresses.some((address) =>
    normalizedAddress(address) === normalizedAddress(savedContractAddress),
  )) {
    throw new Error('The saved contract is not a configured ArcSplit deployment for this network.')
  }
  if (client.chain?.id !== entry.chainId) {
    throw new Error('Connect to the transaction network to verify this distribution.')
  }

  const [transaction, rawReceipt] = await Promise.all([
    client.getTransaction({ hash: entry.txHash }),
    client.getTransactionReceipt({ hash: entry.txHash }),
  ])
  const contractAddress = getAddress(savedContractAddress)
  const payerAddress = getAddress(expectedPayer)
  if (transaction.hash.toLowerCase() !== entry.txHash.toLowerCase()) {
    throw new Error('The fetched transaction hash does not match the saved transaction.')
  }
  if (transaction.from.toLowerCase() !== payerAddress.toLowerCase()) {
    throw new Error('The transaction sender does not match the saved payer.')
  }
  if (!transaction.to || transaction.to.toLowerCase() !== contractAddress.toLowerCase()) {
    throw new Error('The transaction target does not match the saved ArcSplit contract.')
  }

  const receipt = receiptForVerification(rawReceipt)
  if (receipt.status !== 'success') {
    throw new Error('The on-chain transaction did not succeed.')
  }
  if (receipt.transactionHash.toLowerCase() !== entry.txHash.toLowerCase()) {
    throw new Error('The transaction receipt hash does not match the saved transaction.')
  }

  const payerTopic = `0x${payerAddress.slice(2).toLowerCase().padStart(64, '0')}`
  const distributionLogs = receipt.logs.filter((log) =>
    normalizedAddress(log.address) === normalizedAddress(contractAddress)
    && log.topics[0]?.toLowerCase() === distributedTopic.toLowerCase()
    && log.topics[1]?.toLowerCase() === payerTopic,
  )
  if (distributionLogs.length === 0) {
    throw new Error('No matching ArcSplit distribution event was found in the transaction receipt.')
  }

  const block = await client.getBlock({ blockNumber: receipt.blockNumber })
  const verifiedRecords = distributionLogs.map((log) =>
    verifyDistributionReceipt(
      eventLogFromReceipt(log, receipt),
      receipt,
      block,
      payerAddress,
      { chainId: entry.chainId, networkName, contractAddress },
    ),
  )
  if (!isDecimal(entry.totalRaw) || entry.recipients.length === 0) {
    throw new Error('The saved distribution total or recipient list is invalid.')
  }
  const savedTotal = BigInt(entry.totalRaw)
  const matchingRecord = verifiedRecords.find((record) =>
    BigInt(record.totalRaw) === savedTotal
    && record.recipients.length === entry.recipients.length
    && record.recipients.every((recipient, index) => {
      const savedRecipient = entry.recipients[index]
      return !!savedRecipient
        && isAddress(savedRecipient.address)
        && isDecimal(savedRecipient.amountRaw)
        && normalizedAddress(recipient.address) === normalizedAddress(savedRecipient.address)
        && BigInt(recipient.amountRaw) === BigInt(savedRecipient.amountRaw)
    }),
  )
  if (!matchingRecord) {
    throw new Error('The ArcSplit distribution events do not match the saved total, recipients, and amounts.')
  }
  return markLiveVerifiedDistributionRecord(matchingRecord)
}

function receiptForVerification(
  receipt: Awaited<ReturnType<PublicClient['getTransactionReceipt']>>,
): ReceiptForVerification {
  return {
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash,
    logs: receipt.logs.map((log) => ({
      address: log.address,
      data: log.data,
      logIndex: log.logIndex,
      topics: log.topics,
    })),
    status: receipt.status,
    to: receipt.to,
    transactionHash: receipt.transactionHash,
  }
}

function eventLogFromReceipt(
  log: ReceiptLog,
  receipt: ReceiptForVerification,
): EventLog {
  const [topic, ...topics] = log.topics
  if (!topic) throw new Error('The ArcSplit receipt event is missing its signature topic.')
  return {
    address: log.address,
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash,
    logIndex: log.logIndex,
    transactionHash: receipt.transactionHash,
    data: log.data,
    topics: [topic, ...topics],
  }
}

function cachedRecordMatches(
  cached: OnchainDistributionRecord,
  verified: OnchainDistributionRecord,
): boolean {
  return cached.createdAt === verified.createdAt
    && cached.totalRaw === verified.totalRaw
    && cached.recipients.length === verified.recipients.length
    && cached.recipients.every((recipient, index) => {
      const verifiedRecipient = verified.recipients[index]
      return !!verifiedRecipient
        && normalizedAddress(recipient.address) === normalizedAddress(verifiedRecipient.address)
        && recipient.amountRaw === verifiedRecipient.amountRaw
    })
}

async function revalidateCachedRecords(
  client: PublicClient,
  records: OnchainDistributionRecord[],
  options: Pick<OnchainScanOptions, 'chainId' | 'contractAddress' | 'networkName' | 'payer'>,
  onProgress?: OnchainScanOptions['onProgress'],
): Promise<{ records: OnchainDistributionRecord[]; modified: boolean }> {
  if (records.length === 0) return { records, modified: false }

  let modified = false
  onProgress?.({
    phase: 'revalidating',
    blocksScanned: 0n,
    totalBlocks: 0n,
    receiptsChecked: 0,
    totalReceipts: records.length,
  })
  const verifiedRecords = await mapInBatches(
    records,
    RECEIPT_CONCURRENCY,
    async (cachedRecord) => {
      const receipt = receiptForVerification(await requestWithRetry(
        'Revalidating a cached ArcSplit transaction receipt',
        () => client.getTransactionReceipt({ hash: cachedRecord.txHash }),
        { method: 'eth_getTransactionReceipt', contractAddress: options.contractAddress },
      ))
      if (
        receipt.transactionHash.toLowerCase() !== cachedRecord.txHash.toLowerCase()
        || receipt.blockNumber !== cachedRecord.blockNumber
        || receipt.blockHash.toLowerCase() !== cachedRecord.blockHash.toLowerCase()
      ) {
        throw new CachedRecordVerificationError('A cached distribution no longer matches its transaction receipt.')
      }

      const event = receipt.logs.find((log) =>
        log.logIndex === cachedRecord.logIndex
        && normalizedAddress(log.address) === normalizedAddress(options.contractAddress)
        && log.topics[0]?.toLowerCase() === distributedTopic.toLowerCase(),
      )
      if (!event) {
        throw new CachedRecordVerificationError('A cached distribution event is missing from its transaction receipt.')
      }

      const block = await requestWithRetry('Revalidating a cached ArcSplit block', () =>
        client.getBlock({ blockNumber: receipt.blockNumber }),
      {
        method: 'eth_getBlockByNumber',
        contractAddress: options.contractAddress,
        blockNumber: receipt.blockNumber,
      })
      let verified: OnchainDistributionRecord
      try {
        verified = verifyDistributionReceipt(
          eventLogFromReceipt(event, receipt),
          receipt,
          block,
          options.payer,
          options,
        )
      } catch (error) {
        throw new CachedRecordVerificationError(
          `A cached distribution did not match its original event and receipt. ${errorText(error)}`,
        )
      }

      if (verified.id !== cachedRecord.id) {
        throw new CachedRecordVerificationError('A cached distribution identifier did not match its receipt event.')
      }
      if (!cachedRecordMatches(cachedRecord, verified)) modified = true
      return verified
    },
    () => {},
    (completed) => onProgress?.({
      phase: 'revalidating',
      blocksScanned: 0n,
      totalBlocks: 0n,
      receiptsChecked: completed,
      totalReceipts: records.length,
    }),
  )

  return { records: verifiedRecords, modified }
}

async function mapInBatches<T, R>(
  items: readonly T[],
  batchSize: number,
  mapper: (item: T) => Promise<R>,
  onBatchComplete: (completed: number) => void,
  onItemComplete?: (completed: number) => void,
): Promise<R[]> {
  const results: R[] = []
  let completedItems = 0
  for (let start = 0; start < items.length; start += batchSize) {
    const batch = items.slice(start, start + batchSize)
    results.push(...await Promise.all(batch.map(async (item) => {
      const result = await mapper(item)
      completedItems += 1
      onItemComplete?.(completedItems)
      return result
    })))
    onBatchComplete(results.length)
  }
  return results
}

async function performOnchainScan(
  client: PublicClient,
  options: OnchainScanOptions,
): Promise<OnchainScanResult> {
  const { chainId, contractAddress, networkName, payer, forceRescan, onProgress } = options
  if (!isAddress(contractAddress) || !isAddress(payer)) {
    throw new Error('A valid ArcSplit contract and payer address are required for analytics.')
  }

  const key = cacheKey(options)
  const memoryCache = forceRescan ? undefined : scanCaches.get(key)
  const cacheRead = readOnchainScanCache(options)
  const persistedSnapshot = cacheRead.snapshot
  let previous: WalletScanCache | undefined = memoryCache
    ?? (!forceRescan && persistedSnapshot
      ? {
        deploymentBlock: persistedSnapshot.coverage.deploymentBlock,
        ...(persistedSnapshot.coverage.deploymentTimestamp === undefined
          ? {}
          : { deploymentTimestamp: persistedSnapshot.coverage.deploymentTimestamp }),
        scannedThroughBlock: persistedSnapshot.coverage.scannedThroughBlock,
        scannedThroughHash: persistedSnapshot.coverage.scannedThroughHash!,
        records: persistedSnapshot.records,
      }
      : undefined)
  let deploymentBlockHint = memoryCache?.deploymentBlock
    ?? (!forceRescan ? persistedSnapshot?.coverage.deploymentBlock : undefined)
  let cacheWarning = cacheRead.warning

  onProgress?.({
    phase: deploymentBlockHint === undefined ? 'discovering' : 'scanning',
    blocksScanned: 0n,
    totalBlocks: 0n,
    receiptsChecked: 0,
    totalReceipts: 0,
  })

  const latestBlock = await requestWithRetry('Reading the latest Arc block number', () =>
    client.getBlockNumber(),
  { method: 'eth_blockNumber', contractAddress })
  const latest = await requestWithRetry('Reading the latest Arc block', () =>
    client.getBlock({ blockNumber: latestBlock }),
  { method: 'eth_getBlockByNumber', contractAddress, blockNumber: latestBlock })
  if (deploymentBlockHint !== undefined) {
    if (deploymentBlockHint > latestBlock
      || !await validateDeploymentBlockHint(client, contractAddress, deploymentBlockHint)) {
      deploymentBlockHint = undefined
      previous = undefined
      cacheWarning = [
        cacheWarning,
        'The saved deployment block did not match the Arc chain; a full rescan was performed.',
      ].filter(Boolean).join(' ')
    }
  }
  const deploymentBlock = deploymentBlockHint
    ?? await findDeploymentBlock(client, chainId, contractAddress, latestBlock)
  if (previous) {
    let checkpointHash: Hash | undefined
    if (previous.scannedThroughBlock <= latestBlock) {
      try {
        const checkpointBlock = previous.scannedThroughBlock
        checkpointHash = previous.scannedThroughBlock === latestBlock
          ? latest.hash
          : (await requestWithRetry('Validating the cached Arc block', () =>
            client.getBlock({ blockNumber: checkpointBlock }),
          { method: 'eth_getBlockByNumber', contractAddress, blockNumber: checkpointBlock })).hash
      } catch (error) {
        throw new Error(
          `Could not validate cached analytics checkpoint block ${previous.scannedThroughBlock}. ${errorText(error)}`,
        )
      }
    }
    if (checkpointHash?.toLowerCase() !== previous.scannedThroughHash.toLowerCase()) {
      previous = undefined
      cacheWarning = [
        cacheWarning,
        'The saved checkpoint did not match the canonical Arc chain; a full rescan was performed.',
      ].filter(Boolean).join(' ')
    }
  }

  if (previous) {
    if (previous.deploymentBlock !== deploymentBlock) {
      previous = undefined
      cacheWarning = [
        cacheWarning,
        'The saved deployment block did not match the Arc chain; a full rescan was performed.',
      ].filter(Boolean).join(' ')
    } else {
      try {
        const revalidated = await revalidateCachedRecords(client, previous.records, options, onProgress)
        if (revalidated.modified) {
          previous = undefined
          cacheWarning = [
            cacheWarning,
            'A saved distribution record did not match its original event and receipt; a full rescan was performed.',
          ].filter(Boolean).join(' ')
        } else {
          previous = { ...previous, records: revalidated.records }
        }
      } catch (error) {
        if (!(error instanceof CachedRecordVerificationError)) throw error
        previous = undefined
        cacheWarning = [
          cacheWarning,
          `${error.message} A full rescan was performed.`,
        ].filter(Boolean).join(' ')
      }
    }
  }

  const deploymentBlockData = deploymentBlock === latestBlock
    ? latest
    : await requestWithRetry('Reading the ArcSplit deployment block timestamp', () =>
      client.getBlock({ blockNumber: deploymentBlock }),
    { method: 'eth_getBlockByNumber', contractAddress, blockNumber: deploymentBlock })
  const deploymentTimestamp = Number(deploymentBlockData.timestamp) * 1_000
  if (!Number.isSafeInteger(deploymentTimestamp) || deploymentTimestamp <= 0) {
    throw new Error('The ArcSplit deployment block has an invalid timestamp.')
  }

  const scanFromBlock = previous ? previous.scannedThroughBlock + 1n : deploymentBlock
  const totalBlocks = latestBlock >= scanFromBlock ? latestBlock - scanFromBlock + 1n : 0n
  let blocksScanned = 0n
  onProgress?.({
    phase: 'scanning',
    fromBlock: scanFromBlock,
    toBlock: latestBlock,
    blocksScanned,
    totalBlocks,
    receiptsChecked: 0,
    totalReceipts: 0,
  })

  const pendingLogs: EventLog[] = []
  const queryRange = async (fromBlock: bigint, toBlock: bigint): Promise<void> => {
    try {
      const logs: EventLog[] = await requestWithRetry('Reading ArcSplit distribution logs', () =>
        client.getLogs({
          address: contractAddress,
          event: distributedEvent,
          args: { payer },
          fromBlock,
          toBlock,
        }), { method: 'eth_getLogs', contractAddress, fromBlock, toBlock })
      pendingLogs.push(...logs.filter((log) => !log.removed))
      blocksScanned += toBlock - fromBlock + 1n
      onProgress?.({
        phase: 'scanning',
        fromBlock: scanFromBlock,
        toBlock: latestBlock,
        blocksScanned,
        totalBlocks,
        receiptsChecked: 0,
        totalReceipts: 0,
      })
    } catch (error) {
      if (fromBlock < toBlock && isRangeLimitError(error)) {
        const middle = (fromBlock + toBlock) / 2n
        await queryRange(fromBlock, middle)
        await queryRange(middle + 1n, toBlock)
        return
      }
      throw new Error(
        `Could not scan ArcSplit event logs for blocks ${fromBlock}–${toBlock}. ${errorText(error)}`,
      )
    }
  }

  if (scanFromBlock <= latestBlock) {
    for (const range of createBlockRanges(scanFromBlock, latestBlock)) {
      await queryRange(range.fromBlock, range.toBlock)
    }
  }

  const uniqueLogs = new Map<string, EventLog>()
  for (const log of pendingLogs) {
    if (!log.transactionHash || log.blockNumber === null) {
      throw new Error('An ArcSplit Distributed event is missing its transaction or block reference.')
    }
    if (log.logIndex === null || log.blockHash === null) {
      throw new Error('An ArcSplit Distributed event is missing its log reference.')
    }
    uniqueLogs.set(`${log.transactionHash.toLowerCase()}:${log.logIndex}`, log)
  }

  const logs = [...uniqueLogs.values()].sort((first, second) =>
    first.blockNumber! < second.blockNumber!
      ? -1
      : first.blockNumber! > second.blockNumber!
        ? 1
        : first.logIndex! - second.logIndex!,
  )
  const stableRecords = previous?.records ?? []
  const currentLogs = logs
  const blocks = new Map<bigint, Promise<{ timestamp: bigint; hash: Hash }>>()
  blocks.set(latestBlock, Promise.resolve({ timestamp: latest.timestamp, hash: latest.hash }))
  const receipts = new Map<string, ReturnType<PublicClient['getTransactionReceipt']>>()
  let receiptsChecked = 0
  onProgress?.({
    phase: 'verifying',
    fromBlock: scanFromBlock,
    toBlock: latestBlock,
    blocksScanned: totalBlocks,
    totalBlocks,
    receiptsChecked,
    totalReceipts: currentLogs.length,
  })

  const verifiedRecords = await mapInBatches(
    currentLogs,
    RECEIPT_CONCURRENCY,
    async (log) => {
      const hash = log.transactionHash
      const blockNumber = log.blockNumber
      if (!hash || blockNumber === null) {
        throw new Error('An ArcSplit event is missing its transaction or block reference.')
      }
      const normalizedHash = hash.toLowerCase()
      let receiptRequest = receipts.get(normalizedHash)
      if (!receiptRequest) {
        receiptRequest = requestWithRetry('Verifying an ArcSplit transaction receipt', () =>
          client.getTransactionReceipt({ hash }),
        { method: 'eth_getTransactionReceipt', contractAddress })
        receipts.set(normalizedHash, receiptRequest)
      }
      const [receipt, block] = await Promise.all([
        receiptRequest,
        blocks.get(blockNumber) ?? (() => {
          const request = requestWithRetry('Reading an Arc transaction block', () =>
            client.getBlock({ blockNumber }),
          { method: 'eth_getBlockByNumber', contractAddress, blockNumber })
            .then(({ timestamp, hash }) => ({ timestamp, hash }))
          blocks.set(blockNumber, request)
          return request
        })(),
      ])
      return verifyDistributionReceipt(
        log,
        receipt,
        block,
        payer,
        { chainId, networkName, contractAddress },
      )
    },
    (completed) => {
      receiptsChecked = completed
      onProgress?.({
        phase: 'verifying',
        fromBlock: scanFromBlock,
        toBlock: latestBlock,
        blocksScanned: totalBlocks,
        totalBlocks,
        receiptsChecked,
        totalReceipts: currentLogs.length,
      })
    },
  )

  const records = [...stableRecords, ...verifiedRecords].sort((first, second) =>
    first.blockNumber < second.blockNumber
      ? -1
      : first.blockNumber > second.blockNumber
        ? 1
        : first.logIndex - second.logIndex,
  )

  if (previous && previous.scannedThroughBlock < latestBlock) {
    const checkpointBlock = previous.scannedThroughBlock
    const confirmedCheckpoint = await requestWithRetry('Rechecking the cached Arc block', () =>
      client.getBlock({ blockNumber: checkpointBlock }),
    { method: 'eth_getBlockByNumber', contractAddress, blockNumber: checkpointBlock })
    if (confirmedCheckpoint.hash.toLowerCase() !== previous.scannedThroughHash.toLowerCase()) {
      throw new Error('The saved Arc chain checkpoint changed during analytics; retry the scan.')
    }
  }
  const confirmedLatest = await requestWithRetry('Rechecking the latest Arc block', () =>
    client.getBlock({ blockNumber: latestBlock }),
  { method: 'eth_getBlockByNumber', contractAddress, blockNumber: latestBlock })
  if (confirmedLatest.hash.toLowerCase() !== latest.hash.toLowerCase()) {
    throw new Error('The Arc chain head changed during analytics; retry the scan.')
  }

  const snapshot: OnchainScanResult = {
    records,
    coverage: {
      deploymentBlock,
      deploymentTimestamp,
      scannedThroughBlock: latestBlock,
      scannedThroughHash: latest.hash,
    },
  }
  const persistWarning = persistOnchainScanCache(options, snapshot)
  cacheWarning = [cacheWarning, persistWarning].filter(Boolean).join(' ') || undefined
  scanCaches.set(key, {
    deploymentBlock,
    deploymentTimestamp,
    scannedThroughBlock: latestBlock,
    scannedThroughHash: latest.hash,
    records,
  })
  return cacheWarning ? { ...snapshot, cacheWarning } : snapshot
}

export function scanOnchainDistributions(
  client: PublicClient,
  options: OnchainScanOptions,
): Promise<OnchainScanResult> {
  const key = cacheKey(options)
  const existing = scanJobs.get(key)
  if (existing) {
    if (options.forceRescan && !existing.forceRescan) {
      return existing.promise
        .catch(() => undefined)
        .then(() => scanOnchainDistributions(client, options))
    }
    if (options.onProgress) existing.listeners.add(options.onProgress)
    return existing.promise
  }

  const listeners = new Set<(progress: OnchainScanProgress) => void>()
  if (options.onProgress) listeners.add(options.onProgress)
  let promise: Promise<OnchainScanResult>
  promise = performOnchainScan(client, {
    ...options,
    onProgress: (progress) => {
      for (const listener of listeners) listener(progress)
    },
  }).finally(() => {
    if (scanJobs.get(key)?.promise === promise) scanJobs.delete(key)
  })
  scanJobs.set(key, { promise, listeners, forceRescan: options.forceRescan === true })
  return promise
}

export interface LocalOnlyDistribution {
  id: string
  txHash: Hash
  chainId: number
  networkName: string
  contractAddress?: Address
  status: SplitHistoryEntry['status']
  totalRaw: string
  recipients: SplitHistoryEntry['recipients']
  createdAt: number
  source: 'local'
}

export interface MergedDistribution {
  txHash: Hash
  chainId: number
  networkName: string
  totalRaw: string
  recipients: Array<{ address: string; amountRaw: string }>
  createdAt: number
  source: 'on-chain' | 'local'
  status: 'success' | 'failed' | undefined
  contractAddress?: Address
  blockNumber?: bigint
  alsoSavedLocally: boolean
}

export function mergeOnchainAndLocalHistory(
  onchain: OnchainDistributionRecord[],
  local: SplitHistoryEntry[],
  networkName: string,
): { records: MergedDistribution[]; localOnly: LocalOnlyDistribution[] } {
  const localByHash = new Map(local.map((entry) => [entry.txHash.toLowerCase(), entry]))
  const onchainHashes = new Set(onchain.map((entry) => entry.txHash.toLowerCase()))
  const onchainRecords: MergedDistribution[] = onchain.map((entry) => ({
    txHash: entry.txHash,
    chainId: entry.chainId,
    networkName: entry.networkName,
    totalRaw: entry.totalRaw,
    recipients: entry.recipients,
    createdAt: entry.createdAt,
    source: 'on-chain',
    status: 'success',
    contractAddress: entry.contractAddress,
    blockNumber: entry.blockNumber,
    alsoSavedLocally: localByHash.has(entry.txHash.toLowerCase()),
  }))
  const localOnly = local
    .filter((entry) => !onchainHashes.has(entry.txHash.toLowerCase()))
    .map<LocalOnlyDistribution>((entry) => ({
      id: entry.id,
      txHash: entry.txHash,
      chainId: entry.chainId,
      networkName,
      ...(entry.contractAddress ? { contractAddress: entry.contractAddress } : {}),
      status: entry.status,
      totalRaw: entry.totalRaw,
      recipients: entry.recipients,
      createdAt: entry.createdAt,
      source: 'local',
    }))
  const localRecords: MergedDistribution[] = localOnly.map((entry) => ({
    txHash: entry.txHash,
    chainId: entry.chainId,
    networkName: entry.networkName,
    totalRaw: entry.totalRaw,
    recipients: entry.recipients,
    createdAt: entry.createdAt,
    source: 'local',
    status: entry.status,
    ...(entry.contractAddress ? { contractAddress: entry.contractAddress } : {}),
    alsoSavedLocally: true,
  }))
  return {
    records: [...onchainRecords, ...localRecords].sort((first, second) => second.createdAt - first.createdAt),
    localOnly,
  }
}
