import { useState, useCallback } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { TokenUSDC } from '@web3icons/react'
import { AlertCircle, ArrowRight } from 'lucide-react'
import { useUsdcBalance } from '@/hooks/useUsdcBalance'
import {
  ARC_TESTNET_CHAIN_ID,
  parseUsdc,
  formatUsdc,
  ARCSPLIT_ADDRESS,
} from '@/utils/arcsplit'

interface Props {
  onNext: (amountRaw: bigint) => void
}

export function AmountStep({ onNext }: Props) {
  const { address, chainId, isConnected } = useAccount()
  const { switchChain } = useSwitchChain()
  const { raw: balanceRaw, formatted: balanceFormatted, isLoading: balanceLoading } = useUsdcBalance()

  const [input, setInput] = useState('')
  const [error, setError] = useState('')

  const isWrongChain = isConnected && chainId !== ARC_TESTNET_CHAIN_ID
  const isDeployed = !!ARCSPLIT_ADDRESS

  const handleInput = useCallback((val: string) => {
    const clean = val.replace(/[^0-9.]/g, '')
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
        className="rounded-3xl p-5"
        style={{
          background: 'var(--surface-strong)',
          backdropFilter: 'blur(20px)',
          border: '1px solid var(--border)',
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
            <span className="display text-4xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
              {balanceLoading ? '—' : balanceFormatted}
            </span>
            <span className="text-lg font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
          </div>
        ) : (
          <div className="flex items-baseline gap-1.5">
            <span className="display text-4xl font-bold" style={{ color: 'var(--subtle)' }}>—</span>
            <span className="text-lg font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
          </div>
        )}
        <p className="mt-1.5 text-xs" style={{ color: 'var(--muted)' }}>
          {isConnected ? 'Arc Testnet · ERC-20 balance' : 'Connect wallet to see balance'}
        </p>
      </section>

      {/* Amount input */}
      <div
        className="rounded-2xl p-4"
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
            className="display min-w-0 flex-1 bg-transparent text-4xl font-bold tabular-nums outline-none placeholder:text-slate-300"
            style={{ color: 'var(--ink)' }}
            aria-label="USDC amount to split"
            disabled={!isConnected || isWrongChain}
          />
          <div className="flex flex-col items-end gap-1">
            <span className="text-base font-semibold" style={{ color: 'var(--subtle)' }}>USDC</span>
            {isConnected && balanceRaw > 0n && (
              <button
                onClick={handleMax}
                className="text-xs font-semibold"
                style={{ color: 'var(--accent-hover)' }}
              >
                Max
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Inline error */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: 'rgba(186,43,76,0.07)', border: '1px solid rgba(186,43,76,0.18)' }}>
          <AlertCircle className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--danger)' }} />
          <span className="text-sm" style={{ color: 'var(--danger)' }}>{error}</span>
        </div>
      )}

      {/* Contract not deployed banner */}
      {!isDeployed && (
        <div className="flex items-start gap-2 rounded-xl px-3 py-2.5" style={{ background: 'rgba(18,45,69,0.06)', border: '1px solid var(--border)' }}>
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: 'var(--muted)' }} />
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            ArcSplit contract not deployed yet. Set <code className="mono text-xs">VITE_ARCSPLIT_ADDRESS</code> in your <code className="mono text-xs">.env</code> after deploying.
          </p>
        </div>
      )}

      {/* CTA */}
      {!isConnected ? (
        <ConnectKitButton.Custom>
          {({ show }) => (
            <button
              onClick={show}
              className="w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99]"
              style={{ background: 'var(--accent)' }}
            >
              Connect Wallet
            </button>
          )}
        </ConnectKitButton.Custom>
      ) : isWrongChain ? (
        <button
          onClick={() => switchChain({ chainId: ARC_TESTNET_CHAIN_ID })}
          className="w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99]"
          style={{ background: 'var(--accent)' }}
        >
          Switch to Arc Testnet
        </button>
      ) : (
        <button
          onClick={handleContinue}
          disabled={!input || !isDeployed}
          className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: 'var(--accent)' }}
        >
          Continue <ArrowRight className="h-4 w-4" />
        </button>
      )}

      <p className="text-center text-xs" style={{ color: 'var(--subtle)' }}>
        Non-custodial · Arc Testnet · No fees
      </p>
    </div>
  )
}
