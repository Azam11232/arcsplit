import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CSP_REPORT_ONLY_HEADER,
  getCspReportOnlyHeaders,
} from './contentSecurityPolicy'

interface VercelHeadersConfig {
  headers: Array<{
    source: string
    headers: Array<{ key: string; value: string }>
  }>
}

const configPath = resolve(process.cwd(), 'vercel.json')
const config = JSON.parse(readFileSync(configPath, 'utf8')) as VercelHeadersConfig
const route = config.headers.find(({ source }) => source === '/(.*)')
const headers = route?.headers ?? []
const headerValue = (key: string) => headers.find((header) => header.key === key)?.value

describe('Vercel response security headers', () => {
  it('sets baseline production security headers on every route', () => {
    expect(headerValue('Strict-Transport-Security'))
      .toBe('max-age=63072000; includeSubDomains; preload')
    expect(headerValue('X-Frame-Options')).toBe('DENY')
    expect(headerValue('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(headerValue('X-Content-Type-Options')).toBe('nosniff')
  })

  it('uses a Mainnet-only Report-Only CSP in Production', () => {
    const headers = getCspReportOnlyHeaders('production')
    const policy = headers[CSP_REPORT_ONLY_HEADER]

    expect(policy).toContain("connect-src 'self' https://rpc.mainnet.arc.io")
    expect(policy).not.toContain('https://rpc.testnet.arc.io')
    expect(policy).toContain('https://fonts.googleapis.com')
    expect(policy).toContain('https://fonts.gstatic.com')
    expect(policy).toContain("frame-ancestors 'none'")
    expect(Object.keys(headers)).toEqual([CSP_REPORT_ONLY_HEADER])
    expect(headerValue(CSP_REPORT_ONLY_HEADER)).toBeUndefined()
    expect(headerValue('Content-Security-Policy')).toBeUndefined()
    expect(policy).not.toContain('circle.com')
  })

  it('keeps Testnet RPC in the Preview Report-Only CSP', () => {
    const headers = getCspReportOnlyHeaders('preview')
    const policy = headers[CSP_REPORT_ONLY_HEADER]

    expect(policy).toContain(
      "connect-src 'self' https://rpc.mainnet.arc.io https://rpc.testnet.arc.io",
    )
    expect(Object.keys(headers)).toEqual([CSP_REPORT_ONLY_HEADER])
  })

  it('fails closed to Mainnet RPC for unknown environments', () => {
    const policy = getCspReportOnlyHeaders(undefined)[CSP_REPORT_ONLY_HEADER]

    expect(policy).toContain("connect-src 'self' https://rpc.mainnet.arc.io")
    expect(policy).not.toContain('https://rpc.testnet.arc.io')
  })
})
