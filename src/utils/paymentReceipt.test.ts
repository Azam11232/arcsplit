import { describe, expect, it, vi } from 'vitest'
import { encodeAbiParameters, parseAbiItem, toEventSelector } from 'viem'
import type { Address, Hash, PublicClient } from 'viem'
import { getArcNetwork } from './arcsplit'
import { createPaymentReceiptPdf, downloadPaymentReceipt } from './paymentReceipt'
import type { PaymentReceiptData } from './paymentReceipt'
import type { OnchainDistributionRecord } from './onchainAnalytics'
import { verifyHistoryDistributionReceipt } from './onchainAnalytics'
import * as onchainAnalytics from './onchainAnalytics'

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

const payer = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address
const blockHash = `0x${'c'.repeat(64)}` as Hash
const distributedEvent = parseAbiItem(
  'event Distributed(address indexed payer, uint256 totalAmount, uint256 recipientCount)',
)
const recipientPayoutEvent = parseAbiItem(
  'event RecipientPayout(address indexed recipient, uint256 amount)',
)
const contract = getArcNetwork(successfulReceipt.chainId)!.contractAddress
const transactionHash = successfulReceipt.txHash as Hash
const verifiedReceipt: OnchainDistributionRecord = {
  id: `5042:${transactionHash.slice(2).toLowerCase()}:2`,
  chainId: successfulReceipt.chainId,
  contractAddress: successfulReceipt.contractAddress,
  networkName: successfulReceipt.networkName,
  payer,
  txHash: transactionHash,
  blockNumber: 13n,
  blockHash,
  logIndex: 2,
  createdAt: successfulReceipt.createdAt,
  totalRaw: successfulReceipt.totalRaw,
  recipients: successfulReceipt.recipients.map((recipient) => ({
    address: recipient.address as Address,
    amountRaw: recipient.amountRaw,
  })),
  status: 'success',
  verificationStatus: 'receipt-verified',
}
const distributionLogs = [
  {
    address: contract,
    data: encodeAbiParameters([{ type: 'uint256' }], [1_000_000n]),
    logIndex: 0,
    topics: [
      toEventSelector(recipientPayoutEvent),
      encodeAbiParameters([{ type: 'address' }], [successfulReceipt.recipients[0]!.address as Address]),
    ],
  },
  {
    address: contract,
    data: encodeAbiParameters([{ type: 'uint256' }], [500_000n]),
    logIndex: 1,
    topics: [
      toEventSelector(recipientPayoutEvent),
      encodeAbiParameters([{ type: 'address' }], [successfulReceipt.recipients[1]!.address as Address]),
    ],
  },
  {
    address: contract,
    blockNumber: 13n,
    blockHash,
    data: encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }],
      [1_500_000n, 2n],
    ),
    logIndex: 2,
    topics: [
      toEventSelector(distributedEvent),
      encodeAbiParameters([{ type: 'address' }], [payer]),
    ],
    transactionHash,
  },
]

function receiptClient(logs = distributionLogs): PublicClient {
  return {
    chain: { id: successfulReceipt.chainId },
    getTransaction: vi.fn(async () => ({
      hash: transactionHash,
      from: payer,
      to: contract,
    })),
    getTransactionReceipt: vi.fn(async () => ({
      transactionHash,
      blockNumber: 13n,
      blockHash,
      status: 'success',
      to: contract,
      logs,
    })),
    getBlock: vi.fn(async () => ({
      timestamp: BigInt(Math.floor(successfulReceipt.createdAt / 1_000)),
      hash: blockHash,
    })),
  } as unknown as PublicClient
}

describe('payment receipt PDF', () => {
  it('includes live-verified transaction details, full recipients, and a clickable explorer link', async () => {
    const liveVerified = await verifyHistoryDistributionReceipt(
      receiptClient(),
      {
        ...successfulReceipt,
        contractAddress: contract,
      },
      payer,
      'Arc Mainnet',
    )
    const pdf = createPaymentReceiptPdf({
      ...successfulReceipt,
      contractAddress: contract,
    }, liveVerified)
    const output = pdf.output()

    expect(output).toContain('1.50 USDC')
    expect(output).toContain('Date and time')
    expect(output).toContain('Arc Mainnet')
    expect(output).toContain(contract)
    expect(output).toContain(successfulReceipt.txHash)
    expect(output).toContain(successfulReceipt.recipients[0].address)
    expect(output).toContain('1.00 USDC')
    expect(output).toContain('0.50 USDC')
    expect(output).toContain('https://explorer.arc.io/tx/')
    expect(output).toContain('/Subtype /Link')
    expect(output).toContain('/URI')
  })

  it('refuses to create a successful receipt for failed transactions or mismatched payouts', () => {
    expect(() => createPaymentReceiptPdf(successfulReceipt)).toThrow(/has not been verified/i)

    expect(() => createPaymentReceiptPdf(successfulReceipt, verifiedReceipt))
      .toThrow(/live RPC verification proof/i)
  })

  it('rejects fabricated and copied records and exposes no public live-verification marker', async () => {
    expect('markLiveVerifiedDistributionRecord' in onchainAnalytics).toBe(false)

    const fakeRecord = {
      ...verifiedReceipt,
      verificationStatus: 'receipt-verified',
    } satisfies OnchainDistributionRecord
    expect(() => createPaymentReceiptPdf(successfulReceipt, fakeRecord))
      .toThrow(/live RPC verification proof/i)

    const liveVerified = await verifyHistoryDistributionReceipt(
      receiptClient(),
      {
        ...successfulReceipt,
        contractAddress: contract,
      },
      payer,
      'Arc Mainnet',
    )
    const copiedVerified = {
      ...liveVerified,
    }
    expect(() => createPaymentReceiptPdf({
      ...successfulReceipt,
      contractAddress: contract,
    }, copiedVerified)).toThrow(/live RPC verification proof/i)
  })

  it('generates a PDF for the exact record returned by successful live RPC verification', async () => {
    const liveVerified = await verifyHistoryDistributionReceipt(
      receiptClient(),
      {
        ...successfulReceipt,
        contractAddress: contract,
      },
      payer,
      'Arc Mainnet',
    )
    const pdf = createPaymentReceiptPdf({
      ...successfulReceipt,
      contractAddress: contract,
    }, liveVerified)
    expect(pdf.output()).toContain('1.50 USDC')
  })

  it('keeps rejected mismatched saved payout details unrepresented', () => {
    expect(() => createPaymentReceiptPdf({
      ...successfulReceipt,
      status: 'failed',
    }, verifiedReceipt)).toThrow(/live RPC verification proof/i)

    expect(() => createPaymentReceiptPdf({
      ...successfulReceipt,
      totalRaw: '2000000',
    }, verifiedReceipt)).toThrow(/live RPC verification proof/i)

    expect(() => createPaymentReceiptPdf(successfulReceipt, {
      ...verifiedReceipt,
      verificationStatus: 'receipt-verified',
    })).toThrow(/live RPC verification proof/i)
  })

  it('continues recipient details across PDF pages', async () => {
    const recipients = Array.from({ length: 50 }, (_, index) => ({
      address: `0x${(index + 1).toString(16).padStart(40, '0')}`,
      amountRaw: '1000',
    }))
    const payoutLogs = recipients.map((recipient, index) => ({
      address: contract,
      data: encodeAbiParameters([{ type: 'uint256' }], [1_000n]),
      logIndex: index,
      topics: [
        toEventSelector(recipientPayoutEvent),
        encodeAbiParameters([{ type: 'address' }], [recipient.address as Address]),
      ],
    }))
    const distributedLog = {
      address: contract,
      blockNumber: 13n,
      blockHash,
      data: encodeAbiParameters(
        [{ type: 'uint256' }, { type: 'uint256' }],
        [50_000n, 50n],
      ),
      logIndex: 50,
      topics: [
        toEventSelector(distributedEvent),
        encodeAbiParameters([{ type: 'address' }], [payer]),
      ],
      transactionHash,
    }
    const liveClient = receiptClient([...payoutLogs, distributedLog])
    const liveVerified = await verifyHistoryDistributionReceipt(
      liveClient,
      {
        ...successfulReceipt,
        totalRaw: '50000',
        recipients,
        contractAddress: contract,
      },
      payer,
      'Arc Mainnet',
    )
    const pdf = createPaymentReceiptPdf({
      ...successfulReceipt,
      totalRaw: '50000',
      recipients,
      contractAddress: contract,
    }, liveVerified)

    expect(pdf.getNumberOfPages()).toBeGreaterThan(1)
  })

  it('refuses PDF downloads when saved details mismatch or the receipt lacks a distribution event', async () => {
    await expect(downloadPaymentReceipt({
      ...successfulReceipt,
      contractAddress: contract,
      totalRaw: '2000000',
    }, receiptClient(), payer)).rejects.toThrow(/do not match the saved total/i)

    const missingEventClient = receiptClient(distributionLogs.slice(0, 2))
    await expect(downloadPaymentReceipt({
      ...successfulReceipt,
      contractAddress: contract,
    }, missingEventClient, payer)).rejects.toThrow(/no matching ArcSplit distribution event/i)
  })
})
