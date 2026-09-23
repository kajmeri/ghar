import { z } from 'zod'
import { instantFromWallClock, isCalendarDate, isWallClock, type CalendarDate, type TimeZone } from './dates'
import { ValidationError } from './errors'
import { parseMoneyInput, type Cents } from './money'
import { CARRIERS, validateBooking } from './travel/bookings'
import { BOOKING_KINDS, BOOKING_STATUSES, CABINS, RATE_PLANS, type BookingFields } from './travel/types'

// Booking confirmations found in a linked inbox. Everything here is pure: the search that asks the
// mail provider for likely confirmations, the text the model reads, the answer it has to give, and
// the booking that answer turns into. An extracted booking is only ever a draft. A person confirms
// or corrects it before anything is saved.

// ---------------------------------------------------------------------------------------------
// Which messages

/**
 * Where booking confirmations come from, by sender domain: airlines, hotel chains, travel agencies
 * and car rental companies. A subdomain counts, so news.united.com is United.
 */
export const CONFIRMATION_SENDER_DOMAINS = [
  'aa.com', 'united.com', 'delta.com', 'southwest.com', 'jetblue.com', 'alaskaair.com', 'hawaiianairlines.com',
  'flyfrontier.com', 'spirit.com', 'suncountry.com', 'allegiantair.com', 'aircanada.ca', 'westjet.com', 'airfrance.com',
  'britishairways.com', 'lufthansa.com', 'klm.com', 'emirates.com', 'qatarairways.com', 'singaporeair.com', 'airindia.com',
  'marriott.com', 'hilton.com', 'ihg.com', 'hyatt.com', 'wyndhamhotels.com', 'choicehotels.com', 'bestwestern.com',
  'accor.com', 'radissonhotels.com', 'fourseasons.com',
  'expedia.com', 'booking.com', 'hotels.com', 'priceline.com', 'kayak.com', 'orbitz.com', 'travelocity.com', 'hopper.com',
  'agoda.com', 'trip.com', 'airbnb.com', 'vrbo.com', 'makemytrip.com',
  'hertz.com', 'avis.com', 'budget.com', 'enterprise.com', 'nationalcar.com', 'alamo.com', 'sixt.com', 'thrifty.com',
] as const

/** Words a confirmation's subject has. Most marketing from the same senders doesn't. */
export const CONFIRMATION_SUBJECT_TERMS = [
  'confirmation',
  'confirmed',
  'itinerary',
  'reservation',
  'receipt',
  'e-ticket',
  'booking',
  'trip details',
] as const

/** The first check of a newly linked inbox looks this far back, so trips booked before linking turn up. */
export const MAIL_FIRST_LOOKBACK_DAYS = 30
/** Each check starts this long before the last one began, for mail that arrives late. Message ids keep the overlap from being read twice. */
export const MAIL_CURSOR_OVERLAP_MINUTES = 60
/** The most matching message ids one check lists. */
export const MAIL_MAX_LISTED_PER_RUN = 200
/** The most messages one check reads and sends to the model. The rest wait for the next check. */
export const MAIL_MAX_READ_PER_RUN = 25
/** A message whose extraction keeps failing is given up on after this many checks. */
export const MAIL_MAX_ATTEMPTS = 3
/** How much of a message the model reads. Confirmations put the details near the top. */
export const MAIL_BODY_MAX_CHARS = 16_000
/** Stored with a draft so a person can tell which message it came from. */
export const MAIL_SUBJECT_MAX_LENGTH = 200

/** `needs_reconnect` after Google refuses the refresh token. Checks stop until the person connects again. */
export const MAIL_LINK_STATUSES = ['active', 'needs_reconnect'] as const
export type MailLinkStatus = (typeof MAIL_LINK_STATUSES)[number]

/**
 * What became of a message a check listed. `skipped` is from a sender that isn't a known one and was
 * never sent to the model. `failed` is tried again, up to MAIL_MAX_ATTEMPTS times. The rest are final.
 */
export const MAIL_MESSAGE_OUTCOMES = ['draft', 'not_booking', 'skipped', 'failed'] as const
export type MailMessageOutcome = (typeof MAIL_MESSAGE_OUTCOMES)[number]

/** A draft waits as `pending` until someone saves it as a booking or dismisses it. */
export const BOOKING_DRAFT_STATUSES = ['pending', 'confirmed', 'dismissed'] as const
export type BookingDraftStatus = (typeof BOOKING_DRAFT_STATUSES)[number]

const DAY_MS = 86_400_000

function searchTerm(term: string): string {
  return /^[a-z0-9]+$/i.test(term) ? term : `"${term}"`
}

/**
 * The Gmail search for confirmations that arrived after `after`: from a known sender, with a
 * confirmation word in the subject, outside spam and trash. Never the whole inbox.
 */
export function buildConfirmationQuery(input: { after: Date }): string {
  const seconds = Math.floor(input.after.getTime() / 1000)
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    throw new ValidationError('A mail search needs a real start time', { details: { after: String(input.after) } })
  }
  return [
    `from:(${CONFIRMATION_SENDER_DOMAINS.join(' OR ')})`,
    `subject:(${CONFIRMATION_SUBJECT_TERMS.map(searchTerm).join(' OR ')})`,
    `after:${seconds}`,
    '-in:spam',
    '-in:trash',
  ].join(' ')
}

/** Where a check starts: a little before the last check began, or MAIL_FIRST_LOOKBACK_DAYS before linking. */
export function mailSearchStart(input: { lastCheckedAt: Date | null; linkedAt: Date }): Date {
  if (input.lastCheckedAt === null) return new Date(input.linkedAt.getTime() - MAIL_FIRST_LOOKBACK_DAYS * DAY_MS)
  return new Date(input.lastCheckedAt.getTime() - MAIL_CURSOR_OVERLAP_MINUTES * 60_000)
}

/** The domain of a From header, "United <news@news.united.com>" is "news.united.com". Null when there isn't one. */
export function senderDomain(from: string): string | null {
  const address = /<([^<>]*)>\s*$/.exec(from)?.[1] ?? from
  const at = address.lastIndexOf('@')
  if (at < 0) return null
  const domain = address
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(domain) ? domain : null
}

/**
 * Whether a sender is one of CONFIRMATION_SENDER_DOMAINS or a subdomain of one. The search already
 * asks for these, but Gmail's from: also matches display names, so each message is checked again.
 */
export function isConfirmationSender(domain: string | null): boolean {
  if (domain === null) return false
  return CONFIRMATION_SENDER_DOMAINS.some(known => domain === known || domain.endsWith(`.${known}`))
}

// ---------------------------------------------------------------------------------------------
// What the model reads

/** HTML bigger than this is cut before it is flattened. No confirmation needs more. */
const MAIL_HTML_MAX_CHARS = 500_000
/** A plain-text part shorter than this is usually "view this email in your browser". */
const MIN_PLAIN_CHARS = 200

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  euro: '€',
  pound: '£',
  yen: '¥',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const code = entity[1] === 'x' || entity[1] === 'X' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match
  })
}

function tidyText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/(?:[ \t\f\v ﻿]|​|‌|‍)+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** An HTML email as plain text: no tags, styles or scripts, a line per block. */
export function htmlToText(html: string): string {
  const text = html
    .slice(0, MAIL_HTML_MAX_CHARS)
    .replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|table|section|h[1-6])\s*>/gi, '\n')
    .replace(/<\/(td|th)\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
  return tidyText(decodeEntities(text))
}

/**
 * The text the model reads from a message: the plain-text part when it has something to say, the
 * HTML part flattened otherwise, cut to MAIL_BODY_MAX_CHARS.
 */
export function messageText(parts: { plain: string | null; html: string | null }): string {
  const plain = parts.plain === null ? '' : tidyText(parts.plain)
  const text = plain.length >= MIN_PLAIN_CHARS || parts.html === null ? plain : htmlToText(parts.html)
  return text.slice(0, MAIL_BODY_MAX_CHARS)
}

// ---------------------------------------------------------------------------------------------
// Logs

const REDACTIONS: readonly (readonly [RegExp, string])[] = [
  [/[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]'],
  [/\b\d(?:[ -]?\d){12,18}\b/g, '[card]'],
  [/(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\b\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '[phone]'],
  [/\b\d{6,}\b/g, '[number]'],
  [/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5,8}\b/g, '[code]'],
]

/**
 * A string that is safe to log: email addresses, card and phone numbers, long account or ticket
 * numbers and booking codes replaced with a placeholder. For provider error messages. Message
 * bodies and subjects are never logged at all, redacted or not.
 */
export function redactPii(text: string): string {
  return REDACTIONS.reduce((result, [pattern, placeholder]) => result.replace(pattern, placeholder), text)
}

// ---------------------------------------------------------------------------------------------
// What the model answers

const nullableText = (description: string) => z.string().nullable().describe(description)

/**
 * The one JSON object the model must return for a message. The fields are BookingFields, shaped for
 * a model: every one present, null when the message doesn't say, dates and times as they read on
 * the confirmation, and the total as written. bookingFromExtract turns it into a booking draft.
 */
export const bookingExtractSchema = z.object({
  isBooking: z
    .boolean()
    .describe(
      'True only when the message confirms, changes or cancels one specific flight, hotel stay or car rental. False for marketing, loyalty statements, surveys, check-in reminders without booking details, and anything else.'
    ),
  kind: z.enum(BOOKING_KINDS).nullable().describe('What was booked.'),
  status: z.enum(BOOKING_STATUSES).nullable().describe('cancelled when the message cancels the booking, otherwise booked.'),
  confirmationCode: nullableText('The confirmation number, record locator or reservation number.'),
  providerName: nullableText('Who it was booked through: the airline, hotel brand or travel agency. For a car, the rental company.'),
  carrier: nullableText('Flights only: the two-character IATA code of the airline, like UA.'),
  cabin: z.enum(CABINS).nullable().describe('Flights only: the cabin of the first flight.'),
  ratePlan: z
    .enum(RATE_PLANS)
    .nullable()
    .describe('Hotels and cars only: prepaid, pay_at_property (pay at pick-up for a car), or refundable.'),
  refundable: z.boolean().nullable().describe('Flights only: whether the ticket can be refunded.'),
  origin: nullableText('Flights: the three-letter code of the departure airport. Cars: the pick-up location.'),
  destination: nullableText('Flights: the three-letter code of the final arrival airport. Hotels: the city. Cars: the drop-off location.'),
  propertyName: nullableText('Hotels only: the name of the property.'),
  checkIn: nullableText('Hotels and cars: the check-in or pick-up date, as YYYY-MM-DD.'),
  checkOut: nullableText('Hotels and cars: the check-out or drop-off date, as YYYY-MM-DD.'),
  departAt: nullableText('Flights: when the first flight leaves, in local time as printed, as YYYY-MM-DDTHH:mm.'),
  returnAt: nullableText('Flights: when the return flight of a round trip leaves, in local time as printed, as YYYY-MM-DDTHH:mm.'),
  travelers: z.number().int().nullable().describe('How many people the booking covers.'),
  totalPaid: nullableText('The total charged for everyone, digits with up to two decimals and no currency, like 1234.56.'),
  currency: nullableText('The three-letter ISO 4217 code of totalPaid, like USD.'),
})
export type BookingExtract = z.infer<typeof bookingExtractSchema>

/** A booking as the model read it, before anyone has checked it. What was paid may be missing. */
export type BookingDraft = Omit<BookingFields, 'paidCents'> & { paidCents: Cents | null }

/** What has to change before a draft saves, by field, in validateBooking's words. Empty when it would save as is. */
export type BookingProblems = Record<string, string[]>

function calendarDateOrNull(value: string | null): CalendarDate | null {
  const tidy = value?.trim() ?? ''
  return isCalendarDate(tidy) ? tidy : null
}

function instantOrNull(value: string | null, timeZone: TimeZone): Date | null {
  // The model sometimes adds seconds or uses a space. The wall clock is what matters.
  const tidy = (value ?? '').trim().replace(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/, '$1T$2')
  return isWallClock(tidy) ? instantFromWallClock(tidy, timeZone) : null
}

function carrierCode(value: string | null): string | null {
  const tidy = value?.trim() ?? ''
  if (tidy === '') return null
  if (/^[A-Z0-9]{2}$/i.test(tidy)) return tidy.toUpperCase()
  return CARRIERS.find(carrier => carrier.name.toLowerCase() === tidy.toLowerCase())?.code ?? tidy
}

function paidCentsOrNull(value: string | null): Cents | null {
  if (value === null) return null
  try {
    const cents = parseMoneyInput(value.replace(/[^\d.,()-]/g, ''))
    return cents > 0 ? cents : null
  } catch (error) {
    if (error instanceof ValidationError) return null
    throw error
  }
}

/**
 * The draft a person reviews for an extraction, or null when the message isn't a booking or doesn't
 * say what kind. Times are read in the household's zone, as the booking form reads them, so the
 * review shows the times printed on the confirmation. A missing currency is the household's.
 */
export function bookingFromExtract(extract: BookingExtract, household: { timeZone: TimeZone; currency: string }): BookingDraft | null {
  if (!extract.isBooking || extract.kind === null) return null
  const currency = extract.currency?.trim().toUpperCase() ?? ''
  return {
    kind: extract.kind,
    status: extract.status ?? 'booked',
    confirmationCode: extract.confirmationCode,
    providerName: extract.providerName,
    carrier: carrierCode(extract.carrier),
    cabin: extract.cabin,
    ratePlan: extract.ratePlan,
    refundable: extract.refundable ?? false,
    origin: extract.origin,
    destination: extract.destination,
    propertyName: extract.propertyName,
    checkIn: calendarDateOrNull(extract.checkIn),
    checkOut: calendarDateOrNull(extract.checkOut),
    departAt: instantOrNull(extract.departAt, household.timeZone),
    returnAt: instantOrNull(extract.returnAt, household.timeZone),
    travelers: extract.travelers ?? 1,
    paidCents: paidCentsOrNull(extract.totalPaid),
    currency: /^[A-Z]{3}$/.test(currency) ? currency : household.currency,
    watchEnabled: true,
  }
}

/** Every field of a draft that validateBooking would refuse. */
export function bookingProblems(draft: BookingDraft): BookingProblems {
  try {
    validateBooking({ ...draft, paidCents: draft.paidCents ?? 0 })
    return {}
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error
    return (error.details as { fieldErrors?: BookingProblems } | undefined)?.fieldErrors ?? { booking: [error.message] }
  }
}
