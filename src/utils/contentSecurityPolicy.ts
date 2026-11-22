const MAINNET_RPC = 'https://rpc.mainnet.arc.io'
const TESTNET_RPC = 'https://rpc.testnet.arc.io'

export const CSP_REPORT_ONLY_HEADER = 'Content-Security-Policy-Report-Only'

export function getCspReportOnlyHeaders(
  vercelEnvironment: string | undefined,
): Record<typeof CSP_REPORT_ONLY_HEADER, string> {
  const rpcSources = vercelEnvironment === 'preview'
    ? `${MAINNET_RPC} ${TESTNET_RPC}`
    : MAINNET_RPC

  const policy = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${rpcSources}`,
    "frame-src 'self'",
    "worker-src 'self' blob:",
  ].join('; ')

  return { [CSP_REPORT_ONLY_HEADER]: policy }
}
