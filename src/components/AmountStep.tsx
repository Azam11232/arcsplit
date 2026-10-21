import { useState, useCallback } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { TokenUSDC } from '@web3icons/react'
import { AlertCircle, ArrowRight } from 'lucide-react'
import { useUsdcBalance } from '@/hooks/useUsdcBalance'
import {
  ARC_MAINNET_CHAIN_ID,
  ARC_TESTNET_CHAIN_ID,
  parseUsdc,
  formatUsdc,
  getArcNetwork,
} from '@/utils/arcsplit'

interface Props {
  onNext: (amountRaw: bigint) => void
}

export function AmountStep({ onNext }: Props) {
  const { address, chainId, isConnected } = useAccount()
  const { switchChain } = useSwitchChain()
  const network = getArcNetwork(chainId)
  const { raw: balanceRaw, formatted: balanceFormatted, isLoading: balanceLoading } = useUsdcBalance()

  const [input, setInput] = useState('')
  const [error, setError] = useState('')

  const isWrongChain = isConnected && !network
  const isTestnet = isConnected && network?.chainId === ARC_TESTNET_CHAIN_ID
  const isDeployed = !!network?.contractAddress

  const handleInput = useCallback((val: string) => {
    const clean = val.replace(/[^0-9.]/g, '')
    if (/^\d*\.?\d*$/.test(clean) && clean.split('.')[1]?.length > 6) {
      setError('USDC amounts support up to 6 decimal places.')
      return
    }
    if (clean === '' || /^\d*\.?\d{0,6}$/.test(clean)) {
      setInput(clean)
      setError('')
    }
  }, [])

  const handleMax = useCallback(() => {
    if (balanceRaw > 0n) {
      setInput(formatUsdc(balanceRaw))
      setError('')
    }
  }, [balanceRaw])

  const handleContinue = useCallback(() => {
    if (!input || input === '0' || input === '0.00') {
      setError('Enter an amount greater than zero.')
      return
    }
    let raw: bigint
    try {
      raw = parseUsdc(input)
    } catch {
      setError('Invalid amount.')
      return
    }
    if (raw === 0n) {
      setError('Enter an amount greater than zero.')
      return
    }
    if (raw > balanceRaw && address) {
      setError(`Insufficient balance. You have ${balanceFormatted} USDC.`)
      return
    }
    onNext(raw)
  }, [input, balanceRaw, balanceFormatted, address, onNext])

  return (
    <div className="flex flex-col gap-5">
      {/* Balance hero */}
      <section
        className="balance-card rounded-3xl p-5 sm:p-6"
        style={{
          background: 'var(--balance-bg)',
          border: '1px solid var(--balance-border)',
          boxShadow: 'var(--balance-shadow)',
        }}
      >
        <div className="mb-3 flex items-center gap-2">
          <TokenUSDC variant="branded" size={20} />
          <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: 'var(--muted)' }}>
            Your USDC Balance
          </span>
        </div>
        {isConnected ? (
          <div className="flex items-baseline gap-1.5">
            <span className="display max-w-full break-words text-4xl font-bold tabular-nums sm:text-5xl" style={{ color: 'var(--ink)' }}>
              {balanceLoading ? '—' : balanceFormatted}
            </span>
            <span className="text-lg font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
          </div>
        ) : (
          <div className="flex items-baseline gap-1.5">
            <span className="display text-4xl font-bold sm:text-5xl" style={{ color: 'var(--subtle)' }}>—</span>
            <span className="text-lg font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
          </div>
        )}
        <p className="mt-1.5 text-xs" style={{ color: 'var(--muted)' }}>
          {isConnected ? `${network?.name ?? 'Arc'} · ERC-20 balance` : 'Connect wallet to see balance'}
        </p>
      </section>

      {/* Amount input */}
      <div
        className={`amount-field rounded-2xl p-4 sm:p-5${error ? ' amount-field-error' : ''}`}
        style={{
          background: 'var(--surface-muted)',
          border: error ? '1.5px solid var(--danger)' : '1.5px solid var(--border)',
        }}
      >
        <label className="mb-2 block text-xs font-semibold tracking-wide uppercase" style={{ color: 'var(--muted)' }}>
          Amount to Split
        </label>
        <div className="flex items-center gap-2">
          <input
            inputMode="decimal"
            value={input}
            onChange={(e) => handleInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleContinue()}
            placeholder="0.00"
            className="display min-w-0 flex-1 bg-transparent text-3xl font-bold tabular-nums outline-none sm:text-4xl"
            style={{ color: 'var(--ink)' }}
            aria-label="USDC amount to split"
            aria-invalid={!!error}
            aria-describedby={error ? 'amount-error' : undefined}
            disabled={!isConnected || isWrongChain}
          />
          <div className="flex flex-col items-end gap-1">
            <span className="text-base font-semibold" style={{ color: 'var(--subtle)' }}>USDC</span>
            {isConnected && balanceRaw > 0n && (
              <button
                onClick={handleMax}
                className="surface-hover min-h-9 rounded-lg px-2 text-xs font-semibold"
                style={{ color: 'var(--accent-hover)' }}
              >
                Max
              </button>
            )}
          </div>
        </div>
        <p className="mt-2 text-xs" style={{ color: 'var(--subtle)' }}>
          USDC supports up to 6 decimal places.
        </p>
      </div>

      {/* Inline error */}
      {error && (
        <div id="amount-error" role="alert" className="flex items-start gap-2 rounded-xl px-3 py-2.5" style={{ background: 'var(--danger-surface)', border: '1px solid var(--danger-border)' }}>
          <AlertCircle className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--danger)' }} />
          <span className="min-w-0 text-sm leading-relaxed" style={{ color: 'var(--danger)' }}>{error}</span>
        </div>
      )}

      {/* Missing contract address notice */}
      {isConnected && network && !isDeployed && (
        <div className="flex items-start gap-2 rounded-xl px-3 py-2.5" style={{ background: 'var(--info-surface)', border: '1px solid var(--border)' }}>
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: 'var(--muted)' }} />
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            ArcSplit contract address is not configured for this network.
          </p>
        </div>
      )}

      {isTestnet && (
        <div className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ background: 'var(--info-surface)', border: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Arc Testnet is for testing. Switch to Arc Mainnet for production payments.
          </p>
          <button
            onClick={() => switchChain({ chainId: ARC_MAINNET_CHAIN_ID })}
            className="min-h-9 flex-shrink-0 rounded-lg px-2 text-xs font-semibold"
            style={{ color: 'var(--accent-hover)' }}
          >
            Switch to Arc Mainnet
          </button>
        </div>
      )}

      {isWrongChain && (
        <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--info-surface)', border: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            This network is not supported by ArcSplit. Switch to Arc Mainnet to make a payment.
          </p>
        </div>
      )}

      {/* CTA */}
      {!isConnected ? (
        <ConnectKitButton.Custom>
          {({ show }) => (
            <button
              onClick={show}
              className="min-h-12 w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:brightness-110"
              style={{ background: 'var(--accent-gradient)', boxShadow: '0 8px 22px rgba(103,94,232,0.2)' }}
            >
              Connect Wallet
            </button>
          )}
        </ConnectKitButton.Custom>
      ) : isWrongChain ? (
        <button
          onClick={() => switchChain({ chainId: ARC_MAINNET_CHAIN_ID })}
          className="min-h-12 w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:brightness-110"
          style={{ background: 'var(--accent-gradient)', boxShadow: '0 8px 22px rgba(103,94,232,0.2)' }}
        >
          Switch to Arc Mainnet
        </button>
      ) : (
        <button
          onClick={handleContinue}
          disabled={!input || !isDeployed}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: 'var(--accent-gradient)', boxShadow: '0 8px 22px rgba(103,94,232,0.2)' }}
        >
          Continue <ArrowRight className="h-4 w-4" />
        </button>
      )}

      <p className="text-center text-xs" style={{ color: 'var(--subtle)' }}>
        Non-custodial · {network?.name ?? 'Arc Mainnet'} · No fees
      </p>
    </div>
  )
}
