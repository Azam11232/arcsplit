import { describe, expect, it } from 'vitest'
import { createPaymentReceiptPdf } from './paymentReceipt'
import type { PaymentReceiptData } from './paymentReceipt'

const successfulReceipt: PaymentReceiptData = {
  id: 'receipt',
  txHash: `0x${'a'.repeat(64)}`,
  chainId: 5042,
  status: 'success',
  contractAddress: '0x4444444444444444444444444444444444444444',
  networkName: 'Arc Mainnet',
  mode: 'fixed',
  totalRaw: '1500000',
  recipients: [
    { address: '0x1111111111111111111111111111111111111111', amountRaw: '1000000' },
    { address: '0x2222222222222222222222222222222222222222', amountRaw: '500000' },
  ],
  createdAt: Date.UTC(2026, 10, 19, 12),
}

describe('payment receipt PDF', () => {
  it('includes verified transaction details, full recipients, and a clickable explorer link', () => {
    const pdf = createPaymentReceiptPdf(successfulReceipt)
    const output = pdf.output()

    expect(output).toContain('1.50 USDC')
    expect(output).toContain('Date and time')
    expect(output).toContain('Arc Mainnet')
    expect(output).toContain(successfulReceipt.contractAddress)
    expect(output).toContain(successfulReceipt.txHash)
    expect(output).toContain(successfulReceipt.recipients[0].address)
    expect(output).toContain('1.00 USDC')
    expect(output).toContain('0.50 USDC')
    expect(output).toContain('https://explorer.arc.io/tx/')
    expect(output).toContain('/Subtype /Link')
    expect(output).toContain('/URI')
  })

  it('refuses to create a successful receipt for failed transactions or mismatched payouts', () => {
    expect(() => createPaymentReceiptPdf({
      ...successfulReceipt,
      status: 'failed',
    })).toThrow(/only for successful distributions/i)

    expect(() => createPaymentReceiptPdf({
      ...successfulReceipt,
      totalRaw: '2000000',
    })).toThrow(/do not match/i)
  })

  it('continues recipient details across PDF pages', () => {
    const recipients = Array.from({ length: 50 }, (_, index) => ({
      address: `0x${(index + 1).toString(16).padStart(40, '0')}`,
      amountRaw: '1000',
    }))
    const pdf = createPaymentReceiptPdf({
      ...successfulReceipt,
      totalRaw: '50000',
      recipients,
    })

    expect(pdf.getNumberOfPages()).toBeGreaterThan(1)
  })
})
