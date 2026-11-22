import { jsPDF } from 'jspdf'
import { formatUsdc, txUrl } from './arcsplit'
import type { SplitHistoryEntry } from './splitStorage'

export interface PaymentReceiptData extends SplitHistoryEntry {
  networkName: string
  contractAddress: `0x${string}`
}

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 48

function assertReceiptData(entry: PaymentReceiptData): void {
  if (entry.status === 'failed') {
    throw new Error('A PDF receipt is available only for successful distributions.')
  }
  if (!Number.isFinite(entry.createdAt)) {
    throw new Error('The saved transaction date is invalid; the receipt cannot be generated.')
  }

  const total = BigInt(entry.totalRaw)
  const recipientTotal = entry.recipients.reduce(
    (sum, recipient) => sum + BigInt(recipient.amountRaw),
    0n,
  )
  if (total <= 0n || total !== recipientTotal || entry.recipients.length === 0) {
    throw new Error('Saved payout details do not match the successful distribution total.')
  }
}

function addPageFooter(pdf: jsPDF, page: number, pageCount: number): void {
  pdf.setDrawColor(224, 229, 239)
  pdf.line(MARGIN, PAGE_HEIGHT - 38, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 38)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.setTextColor(115, 126, 149)
  pdf.text('ArcSplit · USDC payment receipt', MARGIN, PAGE_HEIGHT - 23)
  pdf.text(`Page ${page} of ${pageCount}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 23, { align: 'right' })
}

export function createPaymentReceiptPdf(entry: PaymentReceiptData): jsPDF {
  assertReceiptData(entry)

  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const network = entry.networkName
  const explorerUrl = txUrl(entry.chainId, entry.txHash)
  const date = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(entry.createdAt))

  pdf.setFillColor(16, 23, 42)
  pdf.roundedRect(MARGIN, 44, PAGE_WIDTH - MARGIN * 2, 102, 14, 14, 'F')
  pdf.setTextColor(255, 255, 255)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(10)
  pdf.text('ARCSPLIT · PAYMENT RECEIPT', MARGIN + 22, 72)
  pdf.setFontSize(24)
  pdf.text(`${formatUsdc(BigInt(entry.totalRaw))} USDC`, MARGIN + 22, 108)
  pdf.setFontSize(9)
  pdf.setTextColor(194, 205, 230)
  pdf.text('CONFIRMED DISTRIBUTION', PAGE_WIDTH - MARGIN - 22, 72, { align: 'right' })

  let y = 176
  pdf.setTextColor(75, 86, 108)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.text('TRANSACTION DETAILS', MARGIN, y)
  y += 18

  const fields: Array<[string, string]> = [
    ['Date and time', date],
    ['Network', network],
    ['Contract address', entry.contractAddress],
    ['Transaction hash', entry.txHash],
  ]

  for (const [label, value] of fields) {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.setTextColor(115, 126, 149)
    pdf.text(label, MARGIN, y)
    pdf.setFont('courier', 'normal')
    pdf.setTextColor(34, 43, 62)
    const lines = pdf.splitTextToSize(value, PAGE_WIDTH - MARGIN * 2 - 132) as string[]
    pdf.text(lines, MARGIN + 132, y)
    y += Math.max(19, lines.length * 12 + 6)
  }

  pdf.setTextColor(76, 91, 125)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  const explorerLabel = 'View transaction on Arc Explorer'
  pdf.text(explorerLabel, MARGIN, y)
  const linkWidth = pdf.getTextWidth(explorerLabel)
  pdf.link(MARGIN, y - 10, linkWidth, 14, { url: explorerUrl })
  y += 26

  const drawRecipientHeader = () => {
    pdf.setFillColor(241, 244, 250)
    pdf.roundedRect(MARGIN, y, PAGE_WIDTH - MARGIN * 2, 24, 5, 5, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.setTextColor(75, 86, 108)
    pdf.text('RECIPIENT WALLET', MARGIN + 10, y + 16)
    pdf.text('AMOUNT', PAGE_WIDTH - MARGIN - 10, y + 16, { align: 'right' })
    y += 34
  }

  drawRecipientHeader()
  entry.recipients.forEach((recipient, index) => {
    const addressLines = pdf.splitTextToSize(
      recipient.address,
      PAGE_WIDTH - MARGIN * 2 - 150,
    ) as string[]
    const rowHeight = Math.max(24, addressLines.length * 12 + 10)
    if (y + rowHeight > PAGE_HEIGHT - 52) {
      pdf.addPage()
      y = 54
      drawRecipientHeader()
    }

    pdf.setFont('courier', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor(54, 65, 87)
    pdf.text(addressLines, MARGIN + 10, y + 11)
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(36, 102, 79)
    pdf.text(
      `${formatUsdc(BigInt(recipient.amountRaw))} USDC`,
      PAGE_WIDTH - MARGIN - 10,
      y + 11,
      { align: 'right' },
    )
    y += rowHeight
    if (index < entry.recipients.length - 1) {
      pdf.setDrawColor(232, 236, 244)
      pdf.line(MARGIN + 10, y, PAGE_WIDTH - MARGIN - 10, y)
      y += 4
    }
  })

  const pageCount = pdf.getNumberOfPages()
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page)
    addPageFooter(pdf, page, pageCount)
  }
  return pdf
}

export function downloadPaymentReceipt(entry: PaymentReceiptData): void {
  const pdf = createPaymentReceiptPdf(entry)
  pdf.save(`arcsplit-receipt-${entry.txHash.slice(2, 10)}.pdf`)
}
