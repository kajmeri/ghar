import 'server-only'
import { formatCalendarDate, formatInstant, type TimeZone } from '@ghar/core/dates'
import { formatCents, type Cents } from '@ghar/core/money'
import { bookingTitle, carrierName, type BookingFields, type DropAction } from '@ghar/core/travel'
import { colors } from '@ghar/tokens'
import type { EmailMessage } from '@/lib/providers/email'
import { escapeHtml } from './html'

export type PriceDropBooking = Pick<
  BookingFields,
  | 'kind'
  | 'carrier'
  | 'providerName'
  | 'confirmationCode'
  | 'origin'
  | 'destination'
  | 'propertyName'
  | 'checkIn'
  | 'checkOut'
  | 'departAt'
  | 'paidCents'
  | 'currency'
>

export interface PriceDropEmailInput {
  to: string
  booking: PriceDropBooking
  /** The household's, for the dates. */
  timeZone: TimeZone
  /** The verified price. */
  priceCents: Cents
  action: DropAction
  /** The booking's page. */
  url: string
}

const CAVEAT = 'Fare and rate rules change. Check the rules on your own booking before you change anything: they are what count.'

/** A verified, capturable drop. Plain on purpose: what dropped, by how much, and what to do. */
export function priceDropEmail(input: PriceDropEmailInput): EmailMessage {
  const { booking } = input
  const money = (cents: Cents) => formatCents(cents, { currency: booking.currency })
  const dropCents = booking.paidCents - input.priceCents
  const percent = Math.round((dropCents / booking.paidCents) * 100)

  const intro = `${describe(booking, input.timeZone)} costs ${money(input.priceCents)} now, ${money(dropCents)} less than you paid.`
  const figures: [string, string][] = [
    ['You paid', money(booking.paidCents)],
    ['Price now', money(input.priceCents)],
    ['Difference', `${money(dropCents)} (${percent}%)`],
  ]
  if (booking.confirmationCode) figures.push(['Confirmation', booking.confirmationCode])
  const steps = whatToDo(input.action, booking)
  const footer = 'You get this because the price watch is on for this booking. You can turn it off on the booking page.'

  const text = [
    intro,
    '',
    ...figures.map(([label, value]) => `${label}: ${value}`),
    '',
    'What to do',
    steps,
    '',
    CAVEAT,
    '',
    `See the booking and its price history: ${input.url}`,
    '',
    footer,
  ].join('\n')

  const muted = `color: ${colors.inkMuted};`
  const rows = figures
    .map(
      ([label, value]) =>
        `<tr><td style="padding: 4px 24px 4px 0; ${muted}">${escapeHtml(label)}</td><td style="padding: 4px 0; font-variant-numeric: tabular-nums;">${escapeHtml(value)}</td></tr>`
    )
    .join('')

  const html = `<div style="font-family: 'Public Sans', ui-sans-serif, system-ui, sans-serif; color: ${colors.ink}; font-size: 16px; line-height: 24px; max-width: 560px;">
  <p style="margin: 0 0 16px;">${escapeHtml(intro)}</p>
  <table role="presentation" style="border-collapse: collapse; margin: 0 0 16px;">${rows}</table>
  <p style="margin: 0; font-weight: 600;">What to do</p>
  <p style="margin: 0 0 16px;">${escapeHtml(steps)}</p>
  <p style="margin: 0 0 16px; font-size: 14px; line-height: 20px; ${muted}">${escapeHtml(CAVEAT)}</p>
  <p style="margin: 0 0 16px;"><a href="${escapeHtml(input.url)}" style="color: ${colors.ink};">See the booking and its price history</a></p>
  <p style="margin: 0; font-size: 14px; line-height: 20px; ${muted}">${escapeHtml(footer)}</p>
</div>`

  return {
    to: input.to,
    subject: `Price drop: ${bookingTitle(booking)} is ${money(dropCents)} cheaper`,
    text,
    html,
  }
}

function describe(booking: PriceDropBooking, timeZone: TimeZone): string {
  const days =
    booking.checkIn && booking.checkOut ? ` from ${formatCalendarDate(booking.checkIn)} to ${formatCalendarDate(booking.checkOut)}` : ''
  switch (booking.kind) {
    case 'flight': {
      const airline = carrierName(booking.carrier)
      const when = booking.departAt ? ` on ${formatInstant(booking.departAt, timeZone, { dateStyle: 'medium' })}` : ''
      return `Your ${airline ? `${airline} ` : ''}flight from ${booking.origin ?? '?'} to ${booking.destination ?? '?'}${when}`
    }
    case 'hotel':
      return `Your stay at ${bookingTitle(booking)}${days}`
    case 'car':
      return `Your car rental${booking.providerName ? ` with ${booking.providerName}` : ''}${days}`
  }
}

function whatToDo(action: DropAction, booking: PriceDropBooking): string {
  const airline = carrierName(booking.carrier) ?? 'the airline'
  switch (action) {
    case 'rebook':
      return booking.kind === 'flight'
        ? 'Book the same flight at the lower fare. Once the new booking is confirmed, cancel the original for a refund.'
        : 'Book the same thing again at the lower rate. Once the new booking is confirmed, cancel the original.'
    case 'call':
      return `Call ${airline}, or whoever you booked through, and ask them to reprice your ticket to the current fare. The difference comes back as a travel credit.`
    case 'claim_credit':
      return `Change to the same flight at the lower fare on ${airline}’s website or app, or call them. The difference comes back as a travel credit.`
  }
}
