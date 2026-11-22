import { useState } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { useAccount, useSwitchChain } from 'wagmi'
import { supportedChains } from '@/config'
import { getArcNetwork } from '@/utils/arcsplit'

function switchErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'shortMessage' in error
    && typeof error.shortMessage === 'string') {
    return error.shortMessage
  }
  if (error instanceof Error && error.message) return error.message
  return 'Network switch failed. Try again in your wallet.'
}

export function NetworkSelector() {
  const { chainId, isConnected } = useAccount()
  const { mutateAsync: switchChainAsync, isPending } = useSwitchChain()
  const [error, setError] = useState('')
  const configuredChain = supportedChains.find((chain) => chain.id === chainId)
  const currentNetwork = getArcNetwork(chainId)
  const value = !isConnected
    ? ''
    : configuredChain
      ? String(configuredChain.id)
      : `unsupported:${chainId ?? 'unknown'}`

  async function handleChange(nextValue: string) {
    const nextChainId = Number(nextValue)
    const nextChain = supportedChains.find((chain) => chain.id === nextChainId)
    if (!nextChain) {
      setError('That network is not available in this build.')
      return
    }

    if (nextChain.id === chainId) return

    setError('')
    try {
      await switchChainAsync({ chainId: nextChain.id })
    } catch (switchError) {
      setError(switchErrorMessage(switchError))
    }
  }

  const currentLabel = !isConnected
    ? 'Wallet not connected'
    : configuredChain
      ? configuredChain.name
      : currentNetwork
        ? `${currentNetwork.name} (not available)`
        : `Unsupported network${chainId === undefined ? '' : ` (${chainId})`}`

  return (
    <div className="flex flex-col items-end gap-1">
      <label className="sr-only" htmlFor="arc-network-selector">Network</label>
      <div className="relative flex items-center">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 h-1.5 w-1.5 rounded-full"
          style={{ background: configuredChain ? 'var(--success)' : 'var(--subtle)' }}
        />
        <select
          id="arc-network-selector"
          aria-label="Network"
          aria-busy={isPending}
          value={value}
          disabled={!isConnected || isPending}
          onChange={(event) => void handleChange(event.currentTarget.value)}
          className="min-h-10 max-w-[220px] appearance-none rounded-xl py-2 pl-6 pr-9 text-xs font-semibold outline-none disabled:cursor-not-allowed disabled:opacity-70"
          style={{
            color: 'var(--ink-2)',
            background: 'var(--surface-muted)',
            border: '1px solid var(--border)',
          }}
        >
          {!isConnected && <option value="">Wallet not connected</option>}
          {isConnected && !configuredChain && (
            <option value={value} disabled>{currentLabel}</option>
          )}
          {supportedChains.map((chain) => (
            <option key={chain.id} value={chain.id}>{chain.name}</option>
          ))}
        </select>
        {isPending
          ? <Loader2 className="pointer-events-none absolute right-3 h-3.5 w-3.5 animate-spin" style={{ color: 'var(--muted)' }} />
          : <ChevronDown className="pointer-events-none absolute right-3 h-3.5 w-3.5" style={{ color: 'var(--muted)' }} />}
      </div>
      {error && (
        <p role="alert" className="max-w-[260px] text-right text-xs" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}
    </div>
  )
}
