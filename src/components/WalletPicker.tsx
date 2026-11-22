import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, Loader2, LogOut, ShieldCheck, Wallet, X } from 'lucide-react'
import { useAccount, useConnect, useConnectors, useDisconnect } from 'wagmi'
import { shortAddress } from '@/utils/arcsplit'

interface Props {
  variant?: 'header' | 'primary'
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'shortMessage' in error
    && typeof error.shortMessage === 'string') {
    return error.shortMessage
  }
  if (error instanceof Error && error.message) return error.message
  return 'The wallet could not complete the request. Check the wallet and try again.'
}

export function WalletPicker({ variant = 'header' }: Props) {
  const { address, isConnected } = useAccount()
  const connectors = useConnectors().filter((connector) => connector.type === 'injected')
  const { mutateAsync: connectAsync, isPending: isConnecting } = useConnect()
  const { mutateAsync: disconnectAsync, isPending: isDisconnecting } = useDisconnect()
  const [isOpen, setIsOpen] = useState(false)
  const [error, setError] = useState('')

  const openPicker = useCallback(() => {
    setError('')
    setIsOpen(true)
  }, [])

  const handleConnect = useCallback(async (connector: (typeof connectors)[number]) => {
    setError('')
    try {
      await connectAsync({ connector })
      setIsOpen(false)
    } catch (connectError) {
      setError(errorMessage(connectError))
    }
  }, [connectAsync])

  const handleDisconnect = useCallback(async () => {
    setError('')
    try {
      await disconnectAsync()
      setIsOpen(false)
    } catch (disconnectError) {
      setError(errorMessage(disconnectError))
    }
  }, [disconnectAsync])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  const primary = variant === 'primary'

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className={`flex min-h-10 items-center justify-center gap-2 rounded-xl px-3 text-xs font-semibold transition-all hover:brightness-110 ${
          primary ? 'min-h-12 w-full rounded-2xl py-3.5 text-sm' : ''
        }`}
        style={{
          color: primary ? '#fff' : 'var(--ink-2)',
          background: primary ? 'var(--accent-gradient)' : 'var(--surface-muted)',
          border: primary ? undefined : '1px solid var(--border)',
          boxShadow: primary ? '0 8px 22px rgba(103,94,232,0.2)' : undefined,
        }}
      >
        <Wallet className="h-4 w-4" aria-hidden="true" />
        {isConnected && address ? shortAddress(address) : 'Connect Wallet'}
      </button>

      {isOpen && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
          onClick={(event) => {
            if (event.target === event.currentTarget) setIsOpen(false)
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-picker-title"
            className="w-full max-w-md overflow-hidden rounded-3xl"
            style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--border-strong)',
              boxShadow: 'var(--card-shadow)',
            }}
          >
            <div className="flex items-start justify-between gap-4 p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <span
                  className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl"
                  style={{ background: 'var(--brand-mark-bg)', border: '1px solid var(--brand-mark-border)' }}
                >
                  <Wallet className="h-5 w-5" style={{ color: 'var(--accent-hover)' }} />
                </span>
                <div>
                  <h2 id="wallet-picker-title" className="display text-lg font-bold" style={{ color: 'var(--ink)' }}>
                    {isConnected ? 'Wallet connected' : 'Connect a wallet'}
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
                    {isConnected
                      ? 'Your wallet stays in control of every transaction.'
                      : 'Choose an injected wallet available in this browser.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Close wallet picker"
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
                style={{ color: 'var(--muted)', background: 'var(--surface-muted)' }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 pb-5 sm:px-6 sm:pb-6">
              {isConnected && address ? (
                <div
                  className="flex items-center justify-between gap-3 rounded-2xl p-4"
                  style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
                >
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                      Connected account
                    </p>
                    <p className="mono mt-1 truncate text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                      {address}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDisconnect()}
                    disabled={isDisconnecting}
                    className="flex min-h-10 flex-shrink-0 items-center gap-2 rounded-xl px-3 text-xs font-semibold disabled:opacity-50"
                    style={{ color: 'var(--danger)', background: 'var(--danger-surface)' }}
                  >
                    {isDisconnecting
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <LogOut className="h-4 w-4" />}
                    Disconnect
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {connectors.map((connector) => (
                    <button
                      key={connector.uid}
                      type="button"
                      onClick={() => void handleConnect(connector)}
                      disabled={isConnecting}
                      className="group flex min-h-[76px] items-center gap-3 rounded-2xl p-4 text-left transition-colors disabled:cursor-wait disabled:opacity-60"
                      style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
                    >
                      <span
                        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
                        style={{ background: 'var(--brand-mark-bg)', color: 'var(--accent-hover)' }}
                      >
                        {isConnecting
                          ? <Loader2 className="h-5 w-5 animate-spin" />
                          : <Wallet className="h-5 w-5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                          Browser wallet
                        </span>
                        <span className="mt-1 block text-xs" style={{ color: 'var(--muted)' }}>
                          MetaMask and other injected wallets
                        </span>
                      </span>
                      {isConnecting
                        ? <span className="text-xs" style={{ color: 'var(--muted)' }}>Waiting…</span>
                        : <ChevronRight className="h-4 w-4" style={{ color: 'var(--muted)' }} />}
                    </button>
                  ))}
                  {connectors.length === 0 && (
                    <p
                      role="status"
                      className="rounded-2xl p-4 text-sm leading-relaxed"
                      style={{ color: 'var(--muted)', background: 'var(--surface-muted)' }}
                    >
                      No injected wallet connector is configured. Enable a browser wallet and reload the app.
                    </p>
                  )}
                </div>
              )}

              {error && (
                <p
                  role="alert"
                  className="mt-3 rounded-xl px-3 py-2.5 text-sm leading-relaxed"
                  style={{ color: 'var(--danger)', background: 'var(--danger-surface)', border: '1px solid var(--danger-border)' }}
                >
                  {error}
                </p>
              )}

              <div
                className="mt-4 flex items-start gap-2 border-t pt-4 text-xs leading-relaxed"
                style={{ color: 'var(--muted)', borderColor: 'var(--border)' }}
              >
                <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: 'var(--success)' }} />
                <p>Non-custodial connection. ArcSplit never receives your keys or requests a WalletConnect project ID.</p>
              </div>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </>
  )
}
