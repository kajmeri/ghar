import { bookingExtractSchema, type BookingExtract } from '@ghar/core/mail'
import { ExtractionError, type BookingExtractor, type MailForExtraction } from './types'

// A reader for local development and tests that needs no API key. It understands only the labelled
// lines the fake Gmail inbox writes ("Kind: flight", "Confirmation: K7Q2ZM"). A message without a
// Kind line isn't a booking.

const LABELS: Record<string, keyof BookingExtract> = {
  kind: 'kind',
  status: 'status',
  confirmation: 'confirmationCode',
  provider: 'providerName',
  carrier: 'carrier',
  cabin: 'cabin',
  'rate plan': 'ratePlan',
  refundable: 'refundable',
  from: 'origin',
  to: 'destination',
  property: 'propertyName',
  'check-in': 'checkIn',
  'check-out': 'checkOut',
  departs: 'departAt',
  returns: 'returnAt',
  travelers: 'travelers',
  total: 'totalPaid',
  currency: 'currency',
}

export const NOT_A_BOOKING: BookingExtract = {
  isBooking: false,
  kind: null,
  status: null,
  confirmationCode: null,
  providerName: null,
  carrier: null,
  cabin: null,
  ratePlan: null,
  refundable: null,
  origin: null,
  destination: null,
  propertyName: null,
  checkIn: null,
  checkOut: null,
  departAt: null,
  returnAt: null,
  travelers: null,
  totalPaid: null,
  currency: null,
}

function readLabelledLines(body: string): Partial<Record<keyof BookingExtract, string>> {
  const found: Partial<Record<keyof BookingExtract, string>> = {}
  for (const line of body.split('\n')) {
    const match = /^([A-Za-z -]+):\s*(.+)$/.exec(line.trim())
    const field = match ? LABELS[(match[1] ?? '').trim().toLowerCase()] : undefined
    if (match && field && found[field] === undefined) found[field] = (match[2] ?? '').trim()
  }
  return found
}

export function createFakeBookingExtractor(): BookingExtractor {
  return {
    extract(mail: MailForExtraction) {
      const lines = readLabelledLines(mail.body)
      if (lines.kind === undefined) return Promise.resolve(NOT_A_BOOKING)
      const { refundable, travelers, ...text } = lines
      const parsed = bookingExtractSchema.safeParse({
        ...NOT_A_BOOKING,
        ...text,
        isBooking: true,
        refundable: refundable === undefined ? null : /^(yes|true)$/i.test(refundable),
        travelers: travelers === undefined ? null : Number(travelers),
      })
      if (!parsed.success) return Promise.reject(new ExtractionError('The sample reader couldn’t read this message.'))
      return Promise.resolve(parsed.data)
    },
  }
}
