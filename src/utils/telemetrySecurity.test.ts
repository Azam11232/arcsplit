import { describe, expect, it } from 'vitest'
import {
  getTrustedParentOrigin,
  isTrustedParentMessage,
  redactRpcMetadata,
  redactTelemetryText,
  redactTelemetryValue,
  REDACTED_VALUE,
} from './telemetrySecurity'

const address = '0x1111111111111111111111111111111111111111'
const transactionHash = `0x${'a'.repeat(64)}`

describe('telemetry security', () => {
  it('accepts only same-origin messages from the embedded parent in development', () => {
    const parent = {}
    const otherWindow = {}
    const origin = 'https://app.example'

    expect(isTrustedParentMessage(parent, origin, parent, origin, true, true)).toBe(true)
    expect(getTrustedParentOrigin(origin, true, true)).toBe(origin)
    expect(getTrustedParentOrigin(origin, false, true)).toBeUndefined()
    expect(getTrustedParentOrigin(origin, true, false)).toBeUndefined()
    expect(getTrustedParentOrigin('null', true, true)).toBeUndefined()
    expect(isTrustedParentMessage(parent, 'https://untrusted.example', parent, origin, true, true)).toBe(false)
    expect(isTrustedParentMessage(otherWindow, origin, parent, origin, true, true)).toBe(false)
    expect(isTrustedParentMessage(parent, origin, parent, origin, false, true)).toBe(false)
    expect(isTrustedParentMessage(parent, origin, parent, origin, true, false)).toBe(false)
    expect(isTrustedParentMessage(parent, 'null', parent, 'null', true, true)).toBe(false)
  })

  it('redacts wallet, transaction, credential and URL data from structured and free-form logs', () => {
    const value = redactTelemetryValue({
      chainId: 5042,
      accountAddress: address,
      params: [{ from: address, to: address, value: '1500000' }],
      transactionHash,
      apiKey: 'sensitive-api-key',
      message: `address=${address} txHash=${transactionHash} mnemonic=amber battery canyon https://rpc.example/v2/private-key`,
      authorization: 'Bearer sensitive-token',
    })
    const serialized = JSON.stringify(value)

    expect(serialized).not.toContain(address)
    expect(serialized).not.toContain(transactionHash)
    expect(serialized).not.toContain('sensitive-api-key')
    expect(serialized).not.toContain('amber battery canyon')
    expect(serialized).not.toContain('sensitive-token')
    expect(serialized).not.toContain('private-key')
    expect(serialized).toContain('5042')
    expect(serialized).toContain(REDACTED_VALUE)
  })

  it('preserves RPC parameter count while removing parameter and result contents', () => {
    const metadata = redactRpcMetadata(
      [{ from: address }, { transactionHash }],
      { transactionHash, result: 'private value' },
    )

    expect(metadata.params).toEqual([REDACTED_VALUE, REDACTED_VALUE])
    expect(metadata.result).toBe(REDACTED_VALUE)
    expect(redactTelemetryText(`request to ${address} failed`)).not.toContain(address)
  })
})
