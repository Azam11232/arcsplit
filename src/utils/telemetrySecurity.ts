export const REDACTED_VALUE = '[REDACTED]'

const sensitiveProperty = /(?:address|account|wallet|recipient|payer|from|to|private.?key|mnemonic|seed.?phrase|secret|password|api.?key|access.?token|token|authorization|signature|signed.?transaction|transaction|tx.?hash|hash|balance|allowance|amount|value|total|nonce|input|calldata|data|params|result|request.?body|response.?body|url)/i
const sensitiveAssignment = /\b(?:api[\s_-]?key|access[\s_-]?token|authorization|password|private[\s_-]?key|secret|seed[\s_-]?(?:phrase)?|mnemonic|signature|signed[\s_-]?transaction|token|wallet|account|address|recipient|payer|from|to|transaction|tx[\s_-]?hash|hash|balance|allowance|amount|value|total|nonce|calldata|input|params|result|data)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\r\n,;}\]]+)/gi
const bearerToken = /\bbearer\s+[a-z0-9._~+/-]+=*/gi
const evmHexValue = /\b0x[0-9a-f]{40,}\b/gi
const url = /\bhttps?:\/\/[^\s"'<>]+/gi

export function isTrustedParentMessage(
  source: unknown,
  origin: string,
  parent: unknown,
  currentOrigin: string,
  isDevelopment: boolean,
  isEmbedded: boolean,
): boolean {
  const trustedOrigin = getTrustedParentOrigin(currentOrigin, isDevelopment, isEmbedded)
  return trustedOrigin !== undefined && source === parent && origin === trustedOrigin
}

export function getTrustedParentOrigin(
  currentOrigin: string,
  isDevelopment: boolean,
  isEmbedded: boolean,
): string | undefined {
  return isDevelopment && isEmbedded && currentOrigin !== 'null'
    ? currentOrigin
    : undefined
}

export function redactTelemetryText(value: string): string {
  return value
    .replace(url, '[REDACTED URL]')
    .replace(sensitiveAssignment, (_match, separator: string) => `${separator}${REDACTED_VALUE}`)
    .replace(bearerToken, `Bearer ${REDACTED_VALUE}`)
    .replace(evmHexValue, REDACTED_VALUE)
}

export function redactTelemetryValue(value: unknown): unknown {
  return redactValue(value, new WeakMap<object, unknown>())
}

function redactValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof value === 'string') return redactTelemetryText(value)
  if (typeof value !== 'object' || value === null) return value
  if (seen.has(value)) return '[Circular]'

  if (Array.isArray(value)) {
    const result: unknown[] = []
    seen.set(value, result)
    for (const item of value) result.push(redactValue(item, seen))
    return result
  }

  const result: Record<string, unknown> = {}
  seen.set(value, result)
  for (const [key, nested] of Object.entries(value)) {
    result[key] = sensitiveProperty.test(key)
      ? REDACTED_VALUE
      : redactValue(nested, seen)
  }
  return result
}

export function redactRpcMetadata(params: unknown[], result: unknown): {
  params: unknown[]
  result: unknown
} {
  return {
    params: params.map(() => REDACTED_VALUE),
    result: result === undefined ? undefined : REDACTED_VALUE,
  }
}
