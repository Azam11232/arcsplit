import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  BarChart3,
  Bookmark,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  Database,
  Download,
  LayoutTemplate,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAccount, usePublicClient } from 'wagmi'
import type { PublicClient } from 'viem'
import { toast } from 'sonner'
import {
  formatUsdc,
  getArcNetwork,
  isValidAddress,
  shortAddress,
  txUrl,
} from '@/utils/arcsplit'
import type { Recipient } from '@/utils/arcsplit'
import {
  getSplitStorageData,
  removeSavedRecipient,
  removeTemplate,
  saveRecipient,
  saveTemplate,
  type SavedRecipient,
  type SplitHistoryEntry,
  type SplitTemplate,
} from '@/utils/splitStorage'
import { calculateSplitAnalytics } from '@/utils/analytics'
import {
  buildDailyDistributionBuckets,
  formatAveragePayment,
  formatUtcDayLabel,
  formatUtcMonthLabel,
} from '@/utils/analytics'
import type { AnalyticsDateRange, DistributionBucket } from '@/utils/analytics'
import { useOnchainAnalytics } from '@/hooks/useOnchainAnalytics'
import type { OnchainContractScanState } from '@/hooks/useOnchainAnalytics'
import { mergeOnchainAndLocalHistory } from '@/utils/onchainAnalytics'
import type {
  LocalOnlyDistribution,
  OnchainDistributionRecord,
  OnchainScanProgress,
  OnchainScanResult,
} from '@/utils/onchainAnalytics'

interface LibraryData {
  accountAddress: `0x${string}` | undefined
  chainId: number | undefined
  networkName: string | undefined
  activeContractAddress: `0x${string}` | undefined
  savedRecipients: SavedRecipient[]
  setSavedRecipients: (recipients: SavedRecipient[]) => void
  templates: SplitTemplate[]
  setTemplates: (templates: SplitTemplate[]) => void
  history: SplitHistoryEntry[]
}

const EMPTY_ANALYTICS_RECORDS: OnchainDistributionRecord[] = []

function useLibraryData(): LibraryData {
  const { address: accountAddress, chainId } = useAccount()
  const contextKey = `${accountAddress?.toLowerCase() ?? 'disconnected'}:${chainId ?? 'unsupported'}`
  const [initialData] = useState(() => getSplitStorageData(accountAddress, chainId))
  const [savedRecipients, setSavedRecipients] = useState<SavedRecipient[]>(
    initialData.recipients,
  )
  const [templates, setTemplates] = useState<SplitTemplate[]>(
    initialData.templates,
  )
  const [history, setHistory] = useState<SplitHistoryEntry[]>(
    initialData.history,
  )
  const [loadedContext, setLoadedContext] = useState(contextKey)
  const network = getArcNetwork(chainId)

  const reload = useCallback(() => {
    const data = getSplitStorageData(accountAddress, chainId)
    setSavedRecipients(data.recipients)
    setTemplates(data.templates)
    setHistory(data.history)
    setLoadedContext(contextKey)
  }, [accountAddress, chainId, contextKey])

  useEffect(() => {
    if (loadedContext !== contextKey) reload()
  }, [contextKey, loadedContext, reload])

  useEffect(() => {
    window.addEventListener('storage', reload)
    return () => window.removeEventListener('storage', reload)
  }, [reload])

  return {
    accountAddress,
    chainId,
    networkName: network?.name,
    activeContractAddress: network?.contractAddress,
    savedRecipients: loadedContext === contextKey ? savedRecipients : [],
    setSavedRecipients,
    templates: loadedContext === contextKey ? templates : [],
    setTemplates,
    history: loadedContext === contextKey ? history : [],
  }
}

function ScreenFrame({
  title,
  description,
  icon: Icon,
  className,
  children,
}: {
  title: string
  description: string
  icon: LucideIcon
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`library-screen flex flex-col gap-6 ${className ?? ''}`}>
      <header className="flex items-start gap-3">
        <div
          className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl"
          style={{ background: 'var(--brand-mark-bg)', border: '1px solid var(--brand-mark-border)', color: 'var(--accent-hover)' }}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h1 className="display text-2xl font-bold tracking-tight" style={{ color: 'var(--ink)' }}>{title}</h1>
          <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{description}</p>
        </div>
      </header>
      {children}
    </section>
  )
}

function EmptyState({ icon: Icon, title, description }: {
  icon: LucideIcon
  title: string
  description: string
}) {
  return (
    <div
      className="flex flex-col items-center rounded-2xl px-5 py-12 text-center sm:px-8"
      style={{ background: 'var(--surface-muted)', border: '1px dashed var(--border)' }}
    >
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl" style={{ color: 'var(--accent-hover)', background: 'var(--info-surface)', border: '1px solid var(--border)' }}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>{title}</h2>
      <p className="mt-1 max-w-sm text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>{description}</p>
    </div>
  )
}

function hasActiveWallet(accountAddress: `0x${string}` | undefined, chainId: number | undefined) {
  return !!accountAddress && !!getArcNetwork(chainId)
}

function generateId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function SavedScreen({ onUseRecipient }: { onUseRecipient: (recipient: SavedRecipient) => void }) {
  const {
    accountAddress,
    chainId,
    networkName,
    savedRecipients,
    setSavedRecipients,
  } = useLibraryData()
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')
  const walletReady = hasActiveWallet(accountAddress, chainId)

  const handleSave = () => {
    const trimmedAddress = address.trim()
    if (!walletReady) {
      setError('Connect a wallet on Arc Mainnet or Arc Testnet to save recipients.')
      return
    }
    if (!name.trim()) {
      setError('Enter a name for this recipient.')
      return
    }
    if (!isValidAddress(trimmedAddress)) {
      setError('Enter a valid, non-zero wallet address.')
      return
    }
    setSavedRecipients(saveRecipient(accountAddress, chainId, {
      name: name.trim(),
      address: trimmedAddress,
    }))
    setName('')
    setAddress('')
    setError('')
    toast.success('Recipient saved for this wallet and network.')
  }

  return (
    <ScreenFrame
      title="Saved recipients"
      description="Manage trusted wallet addresses for the active account and network."
      icon={Bookmark}
    >
      <div className="rounded-2xl p-4 sm:p-5" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
        <div className="mb-4">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Add a recipient</h2>
          <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
            {walletReady
              ? `Saved privately for ${shortAddress(accountAddress!)} on ${networkName}.`
              : 'Connect a supported wallet to access account-specific recipients.'}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto]">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name"
            aria-label="Recipient name"
            className="min-w-0 rounded-xl px-3 py-3 text-sm outline-none"
            style={{ color: 'var(--ink)', background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
          />
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="0x wallet address"
            aria-label="Recipient wallet address"
            className="mono min-w-0 rounded-xl px-3 py-3 text-sm outline-none"
            style={{ color: 'var(--ink)', background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={!walletReady}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--accent-gradient)' }}
          >
            <Plus className="h-4 w-4" /> Save recipient
          </button>
        </div>
        {error && <p role="alert" className="mt-3 text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
      </div>

      {savedRecipients.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No saved recipients yet"
          description="Add an address above or save one while preparing a split. Saved recipients are isolated by wallet and network."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {savedRecipients.map((recipient) => (
            <article
              key={recipient.id}
              className="flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
              style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
            >
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold" style={{ color: 'var(--ink)' }}>{recipient.name}</h2>
                <p className="mono mt-1 break-all text-xs" style={{ color: 'var(--muted)' }}>{recipient.address}</p>
              </div>
              <div className="flex flex-shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => onUseRecipient(recipient)}
                  className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-semibold"
                  style={{ color: 'var(--accent-hover)', background: 'var(--info-surface)', border: '1px solid var(--border)' }}
                >
                  <ArrowDownToLine className="h-3.5 w-3.5" /> Use in Send
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${recipient.name}`}
                  onClick={() => setSavedRecipients(removeSavedRecipient(accountAddress, chainId, recipient.id))}
                  className="flex h-10 w-10 items-center justify-center rounded-xl"
                  style={{ color: 'var(--danger)', background: 'var(--danger-surface)', border: '1px solid var(--border)' }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </ScreenFrame>
  )
}

function restoreTemplate(template: SplitTemplate, currentAmountRaw: bigint): {
  recipients: Recipient[]
  amountRaw: bigint
} | undefined {
  const rows = template.recipients.slice(0, 50)
  if (rows.length === 0) return undefined

  if (template.mode === 'fixed') {
    const recipients = rows.map((row) => ({
      id: generateId(),
      address: row.address,
      amountRaw: BigInt(row.amountRaw),
    }))
    const amountRaw = recipients.reduce((sum, recipient) => sum + recipient.amountRaw, 0n)
    if (amountRaw === 0n || recipients.some((recipient) => recipient.amountRaw === 0n)) return undefined
    return { recipients, amountRaw }
  }

  if (currentAmountRaw === 0n || rows.reduce((sum, row) => sum + row.sharesBps, 0) !== 10_000) {
    return undefined
  }

  let allocated = 0n
  const recipients = rows.map((row, index) => {
    const amountRaw = index === rows.length - 1
      ? currentAmountRaw - allocated
      : (currentAmountRaw * BigInt(row.sharesBps)) / 10_000n
    allocated += amountRaw
    return { id: generateId(), address: row.address, amountRaw }
  })
  if (recipients.some((recipient) => recipient.amountRaw === 0n)) return undefined
  return { recipients, amountRaw: currentAmountRaw }
}

export function TemplatesScreen({
  amountRaw,
  recipients,
  onApply,
}: {
  amountRaw: bigint
  recipients: Recipient[]
  onApply: (recipients: Recipient[], amountRaw: bigint) => void
}) {
  const { accountAddress, chainId, networkName, templates, setTemplates } = useLibraryData()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const walletReady = hasActiveWallet(accountAddress, chainId)
  const allocatedRaw = recipients.reduce((sum, recipient) => sum + recipient.amountRaw, 0n)
  const addresses = recipients.map((recipient) => recipient.address.toLowerCase())
  const canSave = walletReady
    && name.trim().length > 0
    && amountRaw > 0n
    && recipients.length > 0
    && recipients.length <= 50
    && allocatedRaw === amountRaw
    && recipients.every((recipient) => isValidAddress(recipient.address) && recipient.amountRaw > 0n)
    && new Set(addresses).size === addresses.length

  const handleSave = () => {
    if (!walletReady) {
      setError('Connect a wallet on Arc Mainnet or Arc Testnet to save templates.')
      return
    }
    if (!name.trim()) {
      setError('Enter a name for this template.')
      return
    }
    if (!canSave) {
      setError('Complete a valid manual split in Send before saving a template.')
      return
    }
    setTemplates(saveTemplate(accountAddress, chainId, name, recipients))
    setName('')
    setError('')
    toast.success('Manual split template saved.')
  }

  const handleApply = (template: SplitTemplate) => {
    const restored = restoreTemplate(template, amountRaw)
    if (!restored) {
      setError(
        template.mode === 'percentage' && amountRaw === 0n
          ? 'Enter a total amount in Send before converting this older template.'
          : 'This template could not be converted to a valid manual split.',
      )
      return
    }
    setError('')
    onApply(restored.recipients, restored.amountRaw)
  }

  return (
    <ScreenFrame
      title="Split templates"
      description="Save and reuse exact manual USDC allocations for recurring payments."
      icon={LayoutTemplate}
    >
      <div className="rounded-2xl p-4 sm:p-5" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
        <div className="mb-4">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Save current split</h2>
          <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
            {walletReady
              ? `Templates are private to ${shortAddress(accountAddress!)} on ${networkName}.`
              : 'Connect a supported wallet to manage account-specific templates.'}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Template name"
            aria-label="Template name"
            className="min-h-11 min-w-0 flex-1 rounded-xl px-3 text-sm outline-none"
            style={{ color: 'var(--ink)', background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={!walletReady || !name.trim() || !canSave}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--accent-gradient)' }}
          >
            <Plus className="h-4 w-4" /> Save current split
          </button>
        </div>
        <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>
          {canSave
            ? `${formatUsdc(amountRaw)} USDC · ${recipients.length} recipients`
            : 'Finish a valid, fully allocated split in Send to enable saving.'}
        </p>
        {error && <p role="alert" className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
      </div>

      {templates.length === 0 ? (
        <EmptyState
          icon={LayoutTemplate}
          title="No templates yet"
          description="Once you prepare a manual split in Send, save it here to reuse the same recipients and exact amounts."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {templates.map((template) => {
            const total = template.recipients.reduce((sum, recipient) => sum + BigInt(recipient.amountRaw), 0n)
            return (
              <article
                key={template.id}
                className="flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
                style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
              >
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold" style={{ color: 'var(--ink)' }}>{template.name}</h2>
                  <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
                    {formatUsdc(total)} USDC · {template.recipients.length} recipients
                  </p>
                </div>
                <div className="flex flex-shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => handleApply(template)}
                    className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-semibold"
                    style={{ color: 'var(--accent-hover)', background: 'var(--info-surface)', border: '1px solid var(--border)' }}
                  >
                    <ArrowDownToLine className="h-3.5 w-3.5" /> Use in Send
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove template ${template.name}`}
                    onClick={() => setTemplates(removeTemplate(accountAddress, chainId, template.id))}
                    className="flex h-10 w-10 items-center justify-center rounded-xl"
                    style={{ color: 'var(--danger)', background: 'var(--danger-surface)', border: '1px solid var(--border)' }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </ScreenFrame>
  )
}

function historyErrorMessage(error: unknown): string {
  const detail = error instanceof Error
    ? error.message
    : 'Could not verify this transaction receipt.'
  return detail.toLowerCase().includes('no pdf')
    ? detail
    : `${detail} No PDF was generated.`
}

function HistoryEntryCard({
  entry,
  accountAddress,
  publicClient,
}: {
  entry: SplitHistoryEntry
  accountAddress: `0x${string}` | undefined
  publicClient: PublicClient | undefined
}) {
  const [isDownloading, setIsDownloading] = useState(false)
  const network = getArcNetwork(entry.chainId)
  const isSuccessful = entry.status !== 'failed'

  const handleDownload = async () => {
    if (!isSuccessful) return
    if (!network) {
      toast.error('The network for this history entry is not supported.')
      return
    }
    if (!accountAddress) {
      toast.error('Connect the wallet that owns this history entry to verify its receipt.')
      return
    }
    if (!entry.contractAddress) {
      toast.error('The saved ArcSplit contract address is missing. No PDF was generated.')
      return
    }
    if (!publicClient || publicClient.chain?.id !== entry.chainId) {
      toast.error(`Connect to ${network.name} to verify this transaction before downloading its receipt.`)
      return
    }

    setIsDownloading(true)
    try {
      const { downloadPaymentReceipt } = await import('@/utils/paymentReceipt')
      await downloadPaymentReceipt({
        ...entry,
        networkName: network.name,
        contractAddress: entry.contractAddress,
      }, publicClient, accountAddress)
    } catch (error) {
      toast.error(historyErrorMessage(error))
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <article
      className="history-entry rounded-2xl p-4 sm:p-5"
      style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="display text-xl font-bold tabular-nums sm:text-2xl" style={{ color: 'var(--ink)' }}>
              {isSuccessful
                ? `${formatUsdc(BigInt(entry.totalRaw))} USDC`
                : `Attempted ${formatUsdc(BigInt(entry.totalRaw))} USDC`}
            </p>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold"
              style={{
                color: isSuccessful ? 'var(--success)' : 'var(--danger)',
                background: isSuccessful ? 'var(--success-surface)' : 'var(--danger-surface)',
                border: `1px solid ${isSuccessful ? 'var(--success-border)' : 'var(--danger-border)'}`,
              }}
            >
              {isSuccessful
                ? <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                : <XCircle className="h-3 w-3" aria-hidden="true" />}
              {isSuccessful ? 'Confirmed' : 'Reverted · not distributed'}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={{ color: 'var(--muted)' }}>
            <span>{entry.recipients.length} recipient{entry.recipients.length === 1 ? '' : 's'}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
              {new Date(entry.createdAt).toLocaleString()}
            </span>
            {network && <><span aria-hidden="true">·</span><span>{network.name}</span></>}
          </div>
        </div>
        <div className={`grid gap-2 sm:flex sm:shrink-0 sm:justify-end ${isSuccessful ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {network && (
            <a
              href={txUrl(entry.chainId, entry.txHash)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-2.5 text-[10px] font-semibold hover:shadow-sm sm:min-w-36 sm:px-3 sm:text-xs"
              style={{ color: 'var(--accent-hover)', background: 'var(--info-surface)', border: '1px solid var(--info-border)' }}
            >
              View transaction <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          )}
          {isSuccessful && (
            <button
              type="button"
              onClick={() => void handleDownload()}
              disabled={isDownloading}
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-2.5 text-[10px] font-semibold hover:shadow-sm disabled:cursor-wait disabled:opacity-60 sm:min-w-36 sm:px-3 sm:text-xs"
              style={{ color: 'var(--ink)', background: 'var(--surface-muted)', border: '1px solid var(--border-strong)' }}
            >
              <Download className="h-3.5 w-3.5" />
              {isDownloading ? 'Verifying…' : 'Download PDF'}
            </button>
          )}
        </div>
      </div>
      <details className="payout-details mt-4 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
        <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>
          <span>{isSuccessful ? 'Payout details' : 'Attempted payouts'}</span>
          <span className="ml-auto text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
            {entry.recipients.length} payout{entry.recipients.length === 1 ? '' : 's'}
          </span>
          <ChevronDown className="payout-chevron h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
        </summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {entry.recipients.map((recipient, index) => (
            <div
              key={recipient.address}
              className="min-w-0 rounded-xl p-3"
              style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                  Recipient {index + 1}
                </span>
                <span className="whitespace-nowrap text-xs font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>
                  {formatUsdc(BigInt(recipient.amountRaw))} USDC
                </span>
              </div>
              <span className="mono block break-all text-[11px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
                {recipient.address}
              </span>
            </div>
          ))}
        </div>
      </details>
    </article>
  )
}

export function HistoryScreen() {
  const { accountAddress, history, chainId, networkName, activeContractAddress } = useLibraryData()
  const publicClient = usePublicClient()
  const activeHistory = activeContractAddress
    ? history.filter((entry) => (
      entry.chainId === chainId
      && entry.contractAddress?.toLowerCase() === activeContractAddress.toLowerCase()
    ))
    : []
  const hiddenCount = history.length - activeHistory.length
  const transactionCount = activeHistory.length

  return (
    <ScreenFrame
      title="Split history"
      description={`${transactionCount} saved transaction${transactionCount === 1 ? '' : 's'} for the active contract${networkName ? ` on ${networkName}` : ''}.`}
      icon={Clock3}
    >
      {transactionCount === 0 ? (
        <EmptyState
          icon={Clock3}
          title={history.length === 0 ? 'No saved transactions yet' : 'No transactions for the active contract'}
          description={history.length === 0
            ? 'This history is local to the active wallet and network. Earlier or other-device transactions are not imported automatically.'
            : `${hiddenCount} saved record${hiddenCount === 1 ? '' : 's'} for another or unidentified contract remain in local storage and are hidden from this view.`}
        />
      ) : (
        <>
          {hiddenCount > 0 && (
            <p role="status" className="rounded-xl p-3 text-xs" style={{ color: 'var(--muted)', background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
              {hiddenCount} saved record{hiddenCount === 1 ? '' : 's'} for another or unidentified contract remain in local storage and are hidden from this view.
            </p>
          )}
          <div className="history-list mx-auto flex w-full max-w-4xl flex-col gap-3">
            {activeHistory.map((entry) => (
              <HistoryEntryCard
                key={entry.id}
                entry={entry}
                accountAddress={accountAddress}
                publicClient={publicClient}
              />
            ))}
          </div>
        </>
      )}
    </ScreenFrame>
  )
}

function rangeStartDate(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days + 1)
  return date.toISOString().slice(0, 10)
}

type AnalyticsRange = 'all' | 'month' | '7d' | '30d' | '90d' | 'custom'

interface AnalyticsChartMonthControlsProps {
  selectedMonth: string
  monthOptions: string[]
  onMonthChange: (month: string) => void
}

function currentUtcMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

function getAvailableAnalyticsMonths(
  records: OnchainDistributionRecord[],
  deploymentTimestamp?: number,
  now = Date.now(),
): string[] {
  const currentMonth = new Date(now).toISOString().slice(0, 7)
  let firstMonth = currentMonth

  if (
    deploymentTimestamp !== undefined
    && Number.isSafeInteger(deploymentTimestamp)
    && deploymentTimestamp > 0
  ) {
    const deploymentDate = new Date(deploymentTimestamp)
    if (Number.isFinite(deploymentDate.getTime())) {
      const month = deploymentDate.toISOString().slice(0, 7)
      if (month < firstMonth) firstMonth = month
    }
  }

  for (const record of records) {
    const timestamp = new Date(record.createdAt)
    if (!Number.isFinite(timestamp.getTime())) continue
    const month = timestamp.toISOString().slice(0, 7)
    if (month < firstMonth && month <= currentMonth) firstMonth = month
  }

  const months: string[] = []
  const cursor = new Date(`${firstMonth}-01T00:00:00.000Z`)
  const last = new Date(`${currentMonth}-01T00:00:00.000Z`)
  for (; cursor <= last; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    months.push(cursor.toISOString().slice(0, 7))
  }
  return months.reverse()
}

function analyticsMonthDateRange(month: string): AnalyticsDateRange {
  const [yearText, monthText] = month.split('-')
  const year = Number(yearText)
  const monthNumber = Number(monthText)
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10)
  return { startDate: `${month}-01`, endDate: lastDay }
}

function buildAnalyticsChartBuckets(
  records: OnchainDistributionRecord[],
  month: string,
): DistributionBucket[] {
  const dateRange = analyticsMonthDateRange(month)
  return buildDailyDistributionBuckets(
    records,
    'month',
    Date.parse(`${month}-01T00:00:00.000Z`),
    dateRange,
  )
}

function analyticsChartPresentation(
  month: string,
): { title: string; description: string } {
  return {
    title: `Daily Distributions · ${formatUtcMonthLabel(month)}`,
    description: 'Every UTC calendar day in the selected month; inactive days stay visible.',
  }
}

interface AnalyticsRangeControlsProps {
  range: AnalyticsRange
  onRangeChange: (range: AnalyticsRange) => void
  startDate: string
  onStartDateChange: (date: string) => void
  endDate: string
  onEndDateChange: (date: string) => void
}

function AnalyticsRangeControls({
  range,
  onRangeChange,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
}: AnalyticsRangeControlsProps) {
  return (
    <div className="rounded-2xl p-4 sm:px-5" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>On-chain distribution overview</p>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>Verified events and successful receipts · UTC reporting</p>
        </div>
        <label htmlFor="analytics-range" className="flex flex-col items-start gap-1.5 text-xs font-semibold sm:flex-row sm:items-center sm:gap-2" style={{ color: 'var(--ink-2)' }}>
          Date range
          <select
            id="analytics-range"
            value={range}
            onChange={(event) => onRangeChange(event.target.value as AnalyticsRange)}
            className="min-h-10 w-full rounded-xl px-3 text-sm outline-none sm:w-auto sm:min-w-44"
            style={{ color: 'var(--ink)', background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
          >
            <option value="all">All on-chain history</option>
            <option value="month">Monthly</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="custom">Custom</option>
          </select>
        </label>
      </div>
      {range === 'custom' && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs" style={{ color: 'var(--muted)' }}>
            From
            <input
              type="date"
              value={startDate}
              onChange={(event) => onStartDateChange(event.target.value)}
              className="mt-1 min-h-10 w-full rounded-xl px-3 text-sm outline-none"
              style={{ color: 'var(--ink)', background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
            />
          </label>
          <label className="text-xs" style={{ color: 'var(--muted)' }}>
            Through
            <input
              type="date"
              value={endDate}
              onChange={(event) => onEndDateChange(event.target.value)}
              className="mt-1 min-h-10 w-full rounded-xl px-3 text-sm outline-none"
              style={{ color: 'var(--ink)', background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
            />
          </label>
        </div>
      )}
    </div>
  )
}

function MetricCard({
  label,
  value,
  description,
  icon: Icon,
  tone = 'default',
  prominent = false,
  compactValue = false,
}: {
  label: string
  value: string
  description?: string
  icon: LucideIcon
  tone?: 'default' | 'success' | 'danger' | 'accent'
  prominent?: boolean
  compactValue?: boolean
}) {
  const toneColor = tone === 'success'
    ? 'var(--success)'
    : tone === 'danger'
      ? 'var(--danger)'
      : tone === 'accent'
        ? 'var(--accent-hover)'
        : 'var(--ink-2)'
  const valueClassName = compactValue
    ? 'mt-3 mono break-all text-xs font-medium leading-relaxed sm:text-sm'
    : `display mt-3 font-bold tabular-nums leading-tight ${prominent ? 'text-3xl sm:text-4xl' : 'text-2xl'}`

  return (
    <article
      className={`metric-card min-w-0 rounded-2xl p-4 sm:p-5${prominent ? ' xl:col-span-2' : ''}`}
      style={{ background: 'var(--summary-card-bg)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>{label}</p>
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl" style={{ color: toneColor, background: tone === 'success' ? 'var(--success-surface)' : tone === 'danger' ? 'var(--danger-surface)' : 'var(--info-surface)' }}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
      <p className={valueClassName} style={{ color: toneColor, overflowWrap: 'anywhere' }}>{value}</p>
      {description && <p className="mt-2 break-words text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>{description}</p>}
    </article>
  )
}

function formatChartAxisValue(amountRaw: bigint): string {
  const wholeUsdc = amountRaw / 1_000_000n
  const compact = (divisor: bigint, suffix: string) => {
    const tenths = wholeUsdc * 10n / divisor
    return `${tenths / 10n}.${tenths % 10n}${suffix}`
  }
  if (wholeUsdc >= 1_000_000_000n) return compact(1_000_000_000n, 'B')
  if (wholeUsdc >= 1_000_000n) return compact(1_000_000n, 'M')
  if (wholeUsdc >= 1_000n) return compact(1_000n, 'K')
  return formatUsdc(amountRaw)
}

function DistributionChart({
  title,
  buckets,
  description,
  selectedMonth,
  monthOptions,
  onMonthChange,
}: {
  title: string
  buckets: DistributionBucket[]
  description: string
} & AnalyticsChartMonthControlsProps) {
  const maximum = buckets.reduce(
    (max, bucket) => bucket.totalRaw > max ? bucket.totalRaw : max,
    0n,
  )
  const axisMaximum = maximum > 0n ? (maximum * 5n + 3n) / 4n : 0n
  const total = buckets.reduce((sum, bucket) => sum + bucket.totalRaw, 0n)

  return (
    <article
      className="chart-card min-w-0 rounded-2xl p-3 sm:p-5"
      style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{title}</h2>
            <label htmlFor="analytics-chart-month" className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>
              Chart month
              <select
                id="analytics-chart-month"
                value={selectedMonth}
                onChange={(event) => onMonthChange(event.target.value)}
                className="ml-2 min-h-9 rounded-xl px-3 text-sm outline-none"
                style={{ color: 'var(--ink)', background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
              >
                {monthOptions.map((month) => (
                  <option key={month} value={month}>{formatUtcMonthLabel(month)}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>{description}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Period total</p>
          <p className="display mt-0.5 text-sm font-bold tabular-nums" style={{ color: 'var(--ink)' }}>{formatUsdc(total)} USDC</p>
        </div>
      </div>
      {buckets.length === 0 ? (
        <p className="mt-5 rounded-xl p-4 text-center text-xs" style={{ color: 'var(--muted)', background: 'var(--surface-muted)' }}>
          No successful distributions in this date range.
        </p>
      ) : (
        <div className="chart-body mt-6 flex min-w-0 gap-2 sm:gap-3">
          <div className="chart-y-axis relative flex h-36 flex-shrink-0 flex-col justify-between pt-0.5 text-right text-[8px] tabular-nums sm:h-40 sm:text-[9px]" style={{ color: 'var(--muted)' }} aria-label="USDC vertical axis">
            <span className="chart-axis-unit absolute -top-4 right-0 text-[8px] font-semibold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>USDC</span>
            <span title={`${formatUsdc(axisMaximum)} USDC`}>{formatChartAxisValue(axisMaximum)}</span>
            <span title={`${formatUsdc(axisMaximum / 2n)} USDC`}>{formatChartAxisValue(axisMaximum / 2n)}</span>
            <span>0</span>
          </div>
          <div className="min-w-0 flex-1 overflow-x-auto">
          <div
            className="chart-plot relative"
            style={{ minWidth: `${buckets.length * 20}px` }}
          >
            <div className="chart-grid absolute inset-x-0 top-0 h-36 rounded-t-lg sm:h-40" aria-hidden="true" />
            <div
              className="relative grid h-36 min-w-0 items-end sm:h-40"
              style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}
              role="group"
              aria-label={`${title} daily chart`}
            >
              {buckets.map((bucket) => {
                const height = axisMaximum > 0n
                  ? Number((bucket.totalRaw * 1000n) / axisMaximum) / 10
                  : 0
                const exactDay = formatUtcDayLabel(bucket.key)
                const hasActivity = bucket.totalRaw > 0n
                return (
                  <div
                    key={bucket.key}
                    className="chart-column group relative z-10 flex h-full min-w-0 flex-col items-center justify-end"
                    role="img"
                    tabIndex={0}
                    aria-label={hasActivity
                      ? `${exactDay}: ${formatUsdc(bucket.totalRaw)} USDC verified`
                      : `${exactDay}: no distribution activity, ${formatUsdc(bucket.totalRaw)} USDC`}
                    title={`${exactDay} · ${hasActivity ? `${formatUsdc(bucket.totalRaw)} USDC verified` : 'No activity'}`}
                  >
                    <span className="relative flex h-full w-full items-end">
                      <span
                        className={`chart-bar relative mx-auto block w-3/5 max-w-4 ${hasActivity ? 'rounded-t-sm' : ''}`}
                        style={{
                          height: hasActivity ? `${Math.max(height, 4)}%` : '0%',
                          background: hasActivity ? 'var(--accent-gradient)' : 'transparent',
                        }}
                      >
                        <span className="chart-tooltip pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[10px] font-semibold opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus:opacity-100" style={{ color: 'var(--ink)', background: 'var(--surface-strong)', border: '1px solid var(--border-strong)' }}>
                          {hasActivity
                            ? `${exactDay} · ${formatUsdc(bucket.totalRaw)} USDC verified`
                            : `${exactDay} · No activity`}
                        </span>
                      </span>
                    </span>
                  </div>
                )
              })}
            </div>
            <div
              className="grid min-w-0 pt-2"
              style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}
              aria-hidden="true"
            >
              {buckets.map((bucket) => (
                <span
                  key={bucket.key}
                  className="min-w-0 text-center text-[7px] font-medium leading-3 tabular-nums sm:text-[9px]"
                  style={{ color: 'var(--ink-2)' }}
                  title={formatUtcDayLabel(bucket.key)}
                >
                  {bucket.label}
                </span>
              ))}
            </div>
            {total === 0n && (
              <p className="mt-3 text-center text-[10px]" style={{ color: 'var(--muted)' }}>
                No verified distributions in this period.
              </p>
            )}
          </div>
          </div>
        </div>
      )}
      {buckets.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-[10px]" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: 'var(--accent-gradient)' }} aria-hidden="true" />
            USDC distributed
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-2 rounded-full" style={{ background: 'var(--border-strong)' }} aria-hidden="true" />
            No activity
          </span>
        </div>
      )}
    </article>
  )
}

function AnalyticsLoading({
  progress,
  contracts,
  networkName,
  snapshot,
  cacheWarning,
  refresh,
}: {
  progress: OnchainScanProgress
  contracts: OnchainContractScanState[]
  networkName: string | undefined
  snapshot?: OnchainScanResult
  cacheWarning?: string
  refresh: () => void
}) {
  const percentage = progress.totalBlocks > 0n
    ? Math.min(100, Number((progress.blocksScanned * 100n) / progress.totalBlocks))
    : undefined
  const phaseLabel = progress.phase === 'discovering'
    ? 'Finding the contract deployment block…'
    : progress.phase === 'revalidating'
      ? `Revalidating cached receipts: ${progress.receiptsChecked} of ${progress.totalReceipts}…`
      : progress.phase === 'scanning'
        ? 'Scanning ArcSplit distribution events…'
        : `Verifying ${progress.receiptsChecked} of ${progress.totalReceipts} transaction receipts…`

  return (
    <div className="space-y-4">
      <div role="status" aria-live="polite" aria-busy="true" className="rounded-2xl p-4 sm:p-5" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
        <div className="flex items-start gap-3">
          <LoaderCircle className="mt-0.5 h-5 w-5 flex-shrink-0 animate-spin" style={{ color: 'var(--accent-hover)' }} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Loading verified on-chain analytics</p>
            <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>{phaseLabel}{networkName ? ` · ${networkName}` : ''}</p>
            {percentage !== undefined && (
              <div className="mt-3">
                <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--border)' }}>
                  <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${percentage}%`, background: 'var(--accent-gradient)' }} />
                </div>
                <p className="mt-1.5 text-right text-[10px] tabular-nums" style={{ color: 'var(--muted)' }}>{percentage}%</p>
              </div>
            )}
          </div>
        </div>
      </div>
      {snapshot && (
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={refresh}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold"
            style={{ color: 'var(--ink)', background: 'var(--surface-strong)', border: '1px solid var(--border-strong)' }}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Refresh
          </button>
        </div>
      )}
      {snapshot && (
        <StaleCacheNotice />
      )}
      <ContractScanStatusList contracts={contracts} />
      {cacheWarning && (
        <p role="status" className="rounded-xl p-3 text-xs" style={{ color: 'var(--muted)', background: 'var(--surface-muted)' }}>
          {cacheWarning}
        </p>
      )}
      {!snapshot && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
            {[1, 2, 3].map((item) => (
              <div key={item} className="h-32 animate-pulse rounded-2xl" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }} />
            ))}
          </div>
          <div className="grid gap-4" aria-hidden="true">
            <div className="h-64 animate-pulse rounded-2xl" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }} />
          </div>
        </>
      )}
    </div>
  )
}

function contractPhaseLabel(progress: OnchainScanProgress | undefined): string {
  if (!progress) return 'Waiting to start'
  if (progress.phase === 'discovering') return 'Finding deployment block'
  if (progress.phase === 'revalidating') {
    return `Revalidating cached receipts: ${progress.receiptsChecked} of ${progress.totalReceipts}`
  }
  if (progress.phase === 'scanning') {
    return `Scanning events: ${progress.blocksScanned.toString()} of ${progress.totalBlocks.toString()} blocks`
  }
  return `Verifying receipts: ${progress.receiptsChecked} of ${progress.totalReceipts}`
}

function ContractScanStatusList({ contracts }: { contracts: OnchainContractScanState[] }) {
  if (contracts.length === 0) return null

  return (
    <section
      role="status"
      aria-live="polite"
      className="space-y-2 rounded-2xl p-4"
      style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
    >
      <h2 className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>Contract scan status</h2>
      <ul className="space-y-2">
        {contracts.map((contract) => (
          <li key={contract.contractAddress} className="rounded-xl p-3" style={{ background: 'var(--surface)' }}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <code className="break-all text-[11px]" style={{ color: 'var(--muted)' }}>{contract.contractAddress}</code>
              <span className="text-[11px] font-semibold" style={{ color: contract.status === 'failed' ? 'var(--danger)' : 'var(--ink)' }}>
                {contract.status === 'pending'
                  ? 'Pending'
                  : contract.status === 'scanning'
                    ? 'In progress'
                    : contract.status === 'verified'
                      ? 'Verified'
                      : 'Failed'}
              </span>
            </div>
            {contract.status === 'scanning' && (
              <p className="mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
                {contractPhaseLabel(contract.progress)}
              </p>
            )}
            {contract.status === 'failed' && contract.error && (
              <p className="mt-1 break-words text-[11px]" style={{ color: 'var(--danger)' }}>{contract.error}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function AnalyticsError({ message, retry, children }: {
  message: string
  retry: () => void
  children?: ReactNode
}) {
  return (
    <div className="space-y-4">
      <div
        role="alert"
        className="rounded-2xl p-4 sm:p-5"
        style={{ background: 'var(--danger-surface)', border: '1px solid var(--danger-border)' }}
      >
        <div className="flex items-start gap-3">
          <CircleAlert className="mt-0.5 h-5 w-5 flex-shrink-0" style={{ color: 'var(--danger)' }} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>On-chain analytics could not be completed</h2>
            <p className="mt-1 break-words text-xs leading-relaxed" style={{ color: 'var(--ink-2)' }}>{message}</p>
            <p className="mt-2 text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
              No partial results are shown as complete. Locally saved history remains unchanged and is not included in blockchain totals.
            </p>
          </div>
          <div className="flex flex-shrink-0 flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={retry}
              className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors"
              style={{ color: 'var(--ink)', background: 'var(--surface-strong)', border: '1px solid var(--border-strong)' }}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Retry
            </button>
          </div>
        </div>
      </div>
      {children}
    </div>
  )
}

function RecentOnchainDistributions({ records, title = 'Recent confirmed distributions' }: {
  records: OnchainDistributionRecord[]
  title?: string
}) {
  if (records.length === 0) return null

  return (
    <section className="rounded-2xl p-4 sm:p-5" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{title}</h2>
          <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>Latest verified activity, ordered by block timestamp.</p>
        </div>
        <Activity className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--accent-hover)' }} aria-hidden="true" />
      </div>
      <div className="mt-4 divide-y" style={{ borderColor: 'var(--border)' }}>
        {records.slice(-5).reverse().map((record) => (
          <article key={record.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="display text-sm font-bold tabular-nums" style={{ color: 'var(--ink)' }}>{formatUsdc(BigInt(record.totalRaw))} USDC</p>
                <p className="mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
                  {record.networkName} · {record.recipients.length} recipient{record.recipients.length === 1 ? '' : 's'} · {new Date(record.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC
                </p>
              </div>
              <a
                href={txUrl(record.chainId, record.txHash)}
                target="_blank"
                rel="noreferrer"
                aria-label={`View transaction ${record.txHash} on ${record.networkName}`}
                className="inline-flex min-h-9 flex-shrink-0 items-center justify-center gap-1.5 self-start rounded-xl px-3 text-[11px] font-semibold sm:self-auto"
                style={{ color: 'var(--accent-hover)', background: 'var(--info-surface)', border: '1px solid var(--info-border)' }}
              >
                <span>View transaction · <span className="mono" title={record.txHash}>{record.txHash.slice(0, 10)}…{record.txHash.slice(-8)}</span></span>
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </div>
            <details className="payout-details mt-2">
              <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-[11px] font-semibold" style={{ color: 'var(--ink-2)' }}>
                Payout details
                <span className="ml-auto text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
                  {record.recipients.length} payout{record.recipients.length === 1 ? '' : 's'}
                </span>
                <ChevronDown className="payout-chevron h-3.5 w-3.5" aria-hidden="true" />
              </summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {record.recipients.map((recipient) => (
                  <div key={recipient.address} className="min-w-0 rounded-xl p-3" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
                    <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>{formatUsdc(BigInt(recipient.amountRaw))} USDC</p>
                    <p className="mono mt-1 break-all text-[10px] leading-relaxed" style={{ color: 'var(--muted)' }}>{recipient.address}</p>
                  </div>
                ))}
              </div>
            </details>
          </article>
        ))}
      </div>
    </section>
  )
}

function StaleCacheNotice({
  updateFailed = false,
}: {
  updateFailed?: boolean
}) {
  return (
    <section className="rounded-2xl p-4 sm:p-5" style={{ background: 'var(--info-surface)', border: '1px solid var(--info-border)' }}>
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Stale cached snapshot · untrusted</h2>
      <p role="status" className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
        Browser storage cannot authenticate cached analytics and its contents may have been modified. Totals, recipient amounts, and charts are hidden until an RPC scan validates the receipts and checkpoint.
        {' '}{updateFailed
          ? 'The latest update failed; cached financial values remain hidden.'
          : 'An RPC update is in progress; cached financial values remain hidden until verification completes.'}
      </p>
    </section>
  )
}

function LocalOnlyHistory({ records, verificationComplete = true }: {
  records: LocalOnlyDistribution[]
  verificationComplete?: boolean
}) {
  if (records.length === 0) return null

  return (
    <section className="rounded-2xl p-4 sm:p-5" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
      <div className="flex items-start gap-3">
        <Database className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: 'var(--muted)' }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              {verificationComplete ? 'Local-only saved records' : 'Saved records · not verified'}
            </h2>
            <span className="text-[11px] font-medium tabular-nums" style={{ color: 'var(--muted)' }}>
              {verificationComplete ? `${records.length} excluded from analytics` : 'Not counted while scan is incomplete'}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
            {verificationComplete
              ? 'These browser records did not match a verified event from the configured ArcSplit contract. They are preserved, but never counted as confirmed on-chain activity.'
              : 'The RPC scan did not complete, so these browser records cannot yet be matched against the chain. They remain preserved and are not counted as on-chain analytics.'}
          </p>
          <div className="mt-3 space-y-2">
            {records.slice(0, 3).map((record) => (
              <div key={record.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl px-3 py-2" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
                <div className="min-w-0">
                  <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>{formatUsdc(BigInt(record.totalRaw))} USDC</p>
                  <p className="mt-0.5 text-[10px]" style={{ color: 'var(--muted)' }}>
                    {record.status === 'failed' ? 'Locally saved failed attempt' : 'Locally saved · not reverified'} · {record.recipients.length} recipient{record.recipients.length === 1 ? '' : 's'}
                  </p>
                </div>
                <span className="mono max-w-full break-all text-[10px]" style={{ color: 'var(--muted)' }}>{record.txHash}</span>
              </div>
            ))}
          </div>
          {records.length > 3 && (
            <p className="mt-2 text-[10px]" style={{ color: 'var(--muted)' }}>{records.length - 3} more preserved in History.</p>
          )}
        </div>
      </div>
    </section>
  )
}

export function AnalyticsScreen() {
  const { accountAddress, chainId, history, networkName } = useLibraryData()
  const { state: onchainState, retry, refresh, network } = useOnchainAnalytics(accountAddress, chainId)
  const [range, setRange] = useState<AnalyticsRange>('month')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [selectedMonth, setSelectedMonth] = useState(currentUtcMonth)
  const rangeControls = {
    range,
    onRangeChange: setRange,
    startDate,
    onStartDateChange: setStartDate,
    endDate,
    onEndDateChange: setEndDate,
  }
  const walletReady = hasActiveWallet(accountAddress, chainId)
  const expectedContractCount = network?.analyticsContractAddresses.length ?? 1
  const verifiedContractCount = onchainState.status === 'partial'
    ? onchainState.contracts.filter((contract) => contract.status === 'verified').length
    : expectedContractCount
  const onchainRecords = onchainState.status === 'ready' || onchainState.status === 'partial'
    ? onchainState.records
    : EMPTY_ANALYTICS_RECORDS
  const cachedSnapshot = onchainState.status === 'loading' || onchainState.status === 'error'
    ? onchainState.snapshot
    : undefined
  const displayRecords = onchainRecords
  const deploymentTimestamp = onchainState.status === 'ready' || onchainState.status === 'partial'
    ? onchainState.deploymentTimestamp
    : undefined
  const monthOptions = useMemo(
    () => getAvailableAnalyticsMonths(displayRecords, deploymentTimestamp),
    [deploymentTimestamp, displayRecords],
  )
  const chartMonthControls: AnalyticsChartMonthControlsProps = {
    selectedMonth: monthOptions.includes(selectedMonth)
      ? selectedMonth
      : monthOptions[0] ?? currentUtcMonth(),
    monthOptions,
    onMonthChange: setSelectedMonth,
  }
  const analyticsHistory = useMemo(
    () => history.filter((entry) => {
      if (!entry.contractAddress) return true
      return network?.analyticsContractAddresses.some((address) =>
        address.toLowerCase() === entry.contractAddress?.toLowerCase(),
      ) ?? false
    }),
    [history, network],
  )
  const mergedHistory = useMemo(
    () => mergeOnchainAndLocalHistory(displayRecords, analyticsHistory, networkName ?? 'Arc network'),
    [displayRecords, analyticsHistory, networkName],
  )

  const dateRange = useMemo<AnalyticsDateRange>(() => {
    if (range === 'custom') {
      return {
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      }
    }
    if (range === 'all') return {}
    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    if (range === 'month') {
      const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
        .toISOString()
        .slice(0, 10)
      return { startDate: `${today.slice(0, 7)}-01`, endDate: monthEnd }
    }
    return { startDate: rangeStartDate(Number(range.slice(0, -1))), endDate: today }
  }, [range, startDate, endDate])

  const dateRangeError = range === 'custom'
    && !!startDate
    && !!endDate
    && startDate > endDate
  const analytics = useMemo(
    () => dateRangeError ? undefined : calculateSplitAnalytics(onchainRecords, dateRange),
    [onchainRecords, dateRange, dateRangeError],
  )
  const chartBuckets = useMemo(
    () => buildAnalyticsChartBuckets(onchainRecords, chartMonthControls.selectedMonth),
    [chartMonthControls.selectedMonth, onchainRecords],
  )
  const chartPresentation = useMemo(
    () => analyticsChartPresentation(chartMonthControls.selectedMonth),
    [chartMonthControls.selectedMonth],
  )
  const hasRangeEntries = !!analytics && analytics.successfulCount > 0

  return (
    <ScreenFrame
      title="Payment analytics"
      description={`Receipt-verified ArcSplit distributions${networkName ? ` on ${networkName}` : ''}, scoped to this wallet and network.`}
      icon={BarChart3}
      className="analytics-screen"
    >
      {!walletReady ? (
        <EmptyState
          icon={BarChart3}
          title="Connect a supported wallet"
          description="Connect to Arc Mainnet or Arc Testnet to scan this wallet's confirmed ArcSplit distributions."
        />
      ) : onchainState.status === 'loading' ? (
        <AnalyticsLoading
          progress={onchainState.progress}
          contracts={onchainState.contracts}
          networkName={networkName}
          snapshot={onchainState.snapshot}
          cacheWarning={onchainState.cacheWarning}
          refresh={refresh}
        />
      ) : onchainState.status === 'error' ? (
        <AnalyticsError message={onchainState.message} retry={retry}>
          {onchainState.snapshot && (
            <StaleCacheNotice
              updateFailed
            />
          )}
          <LocalOnlyHistory records={mergedHistory.localOnly} verificationComplete={false} />
        </AnalyticsError>
      ) : onchainState.status !== 'ready' && onchainState.status !== 'partial' ? (
        <EmptyState
          icon={BarChart3}
          title="Connect a supported wallet"
          description="Connect to an Arc network to scan receipt-verified distribution events."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Verified through block {onchainState.scannedThroughBlock.toString()}
              {onchainState.status === 'partial'
                ? ` across ${verifiedContractCount} of ${expectedContractCount} contracts`
                : ` across ${expectedContractCount} contract${expectedContractCount === 1 ? '' : 's'}`}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={refresh}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold"
                style={{ color: 'var(--ink)', background: 'var(--surface-strong)', border: '1px solid var(--border-strong)' }}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Refresh
              </button>
            </div>
          </div>
          {onchainState.status === 'partial' && (
            <>
              <p role="alert" className="rounded-xl p-3 text-xs" style={{ color: 'var(--warning)', background: 'var(--warning-surface)' }}>
                Partial verified results: {onchainState.warning}
              </p>
              <ContractScanStatusList contracts={onchainState.contracts} />
            </>
          )}
          {onchainState.status === 'ready' && onchainState.cacheWarning && (
            <p role="status" className="rounded-xl p-3 text-xs" style={{ color: 'var(--muted)', background: 'var(--surface-muted)' }}>
              {onchainState.cacheWarning}
            </p>
          )}
          <AnalyticsRangeControls {...rangeControls} />

          {dateRangeError ? (
            <p role="alert" className="rounded-xl p-3 text-xs" style={{ color: 'var(--danger)', background: 'var(--danger-surface)' }}>
              The start date must be on or before the end date.
            </p>
          ) : !analytics ? (
            <EmptyState
              icon={Clock3}
              title="Analytics unavailable for this date range"
              description="Choose valid calendar dates to view this wallet’s receipt-verified on-chain activity."
            />
          ) : !hasRangeEntries ? (
            <EmptyState
              icon={Clock3}
              title={onchainRecords.length === 0 ? 'No confirmed distributions found' : 'No distributions in this date range'}
              description={onchainRecords.length === 0
                ? `The complete scan found no confirmed ArcSplit distributions for this wallet on ${networkName ?? 'the active network'}. Locally saved records are shown separately below.`
                : 'Choose another date range to view this wallet’s receipt-verified on-chain activity.'}
            />
          ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <MetricCard
                  label="Total USDC distributed"
                  value={`${formatUsdc(analytics.totalRaw)} USDC`}
                  description="Sum of verified on-chain payouts"
                  icon={ArrowUpRight}
                  tone="accent"
                  prominent
                />
                <MetricCard
                  label="Highest receiving wallet"
                  value={analytics.topRecipient?.address ?? '—'}
                  description={analytics.topRecipient
                    ? `${formatUsdc(analytics.topRecipient.totalRaw)} USDC received`
                    : 'No successful payouts in this range'}
                  icon={Wallet}
                  tone="accent"
                  compactValue
                />
                <MetricCard
                  label="Average payment"
                  value={formatAveragePayment(analytics.averageRaw)}
                  description="Average of successful distributions"
                  icon={BarChart3}
                />
                <MetricCard
                  label="Confirmed distributions"
                  value={String(analytics.successfulCount)}
                  description="Successful ArcSplit receipts"
                  icon={CheckCircle2}
                  tone="success"
                />
                <MetricCard
                  label="Reverted transactions"
                  value="Not indexed"
                  description="Reverted calls emit no persistent contract events"
                  icon={XCircle}
                  tone="danger"
                  compactValue
                />
              </div>
          )}
          <div className="analytics-distribution-charts grid w-full min-w-0 gap-4">
            <DistributionChart
              title={chartPresentation.title}
              description={chartPresentation.description}
              buckets={chartBuckets}
              {...chartMonthControls}
            />
          </div>
          {onchainState.status === 'ready' && (
            <>
              <aside className="flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5" style={{ background: 'var(--info-surface)', border: '1px solid var(--info-border)' }}>
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: 'var(--accent-hover)' }} aria-hidden="true" />
                  <div>
                    <p className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>Complete on-chain scan</p>
                    <p className="mt-1 max-w-3xl text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
                      Source: Distributed and RecipientPayout logs from configured {network?.name} contract histories; every transaction receipt and payout total was verified. Chart dates use block timestamps. Coverage: block {onchainState.deploymentBlock.toString()} through {onchainState.scannedThroughBlock.toString()} across all configured contracts. Reverted calls do not emit persistent events and cannot be recovered by this scan.
                    </p>
                  </div>
                </div>
                <span className="whitespace-nowrap text-[11px] font-medium sm:text-right" style={{ color: 'var(--ink-2)' }}>
                  {onchainRecords.length} verified
                </span>
              </aside>
              <RecentOnchainDistributions records={onchainRecords} />
              <LocalOnlyHistory records={mergedHistory.localOnly} />
            </>
          )}
        </>
      )}
    </ScreenFrame>
  )
}
