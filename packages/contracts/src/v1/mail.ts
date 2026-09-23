import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { linkAuthorizationBodySchema, linkAuthorizationSchema, linkCompletionBodySchema } from './calendar'
import { pageQuerySchema, pageSchema } from './shared'
import { bookingBodySchema, bookingKindSchema, bookingSchema, bookingStatusSchema, cabinSchema, ratePlanSchema } from './travel'

// Bookings read from a person's own Gmail. Linking starts in a browser at /api/mail/google/connect,
// which asks Google for read-only access. Nothing read from mail becomes a booking until its person
// confirms or corrects the draft here. These lists mirror @ghar/core/mail. A test keeps them equal.

export const mailLinkStatusSchema = z.enum(['active', 'needs_reconnect'])

const calendarDateSchema = z.iso.date()
const instantSchema = z.iso.datetime({ offset: true })

export const mailLinkSchema = z.object({
  accountEmail: z.string(),
  /** `needs_reconnect` means Google stopped accepting the connection. Linking again carries on. */
  status: mailLinkStatusSchema,
  lastError: z.string().nullable(),
  /** When the last check that got through everything began. Null before the first. */
  lastCheckedAt: instantSchema.nullable(),
  createdAt: instantSchema,
})
export type MailLink = z.infer<typeof mailLinkSchema>

export const mailCheckOutcomeSchema = z.enum(['checked', 'needs_reconnect', 'error', 'skipped'])

export const mailCheckResultSchema = z.object({
  outcome: mailCheckOutcomeSchema,
  /** Messages the search matched, up to the listing limit. */
  listed: z.number().int(),
  /** Messages opened this check. Ones seen before are never opened again. */
  read: z.number().int(),
  drafts: z.number().int(),
  notBookings: z.number().int(),
  /** Matched the search, but not from a sender Ghar reads. */
  skipped: z.number().int(),
  failed: z.number().int(),
  /** False when there's more to read. The next check carries on from there. */
  complete: z.boolean(),
})
export type MailCheckResult = z.infer<typeof mailCheckResultSchema>

/** A booking as read from an email, before anyone checked it. Amount paid may be missing. */
export const draftBookingSchema = z.object({
  kind: bookingKindSchema,
  status: bookingStatusSchema,
  confirmationCode: z.string().nullable(),
  providerName: z.string().nullable(),
  carrier: z.string().nullable(),
  cabin: cabinSchema.nullable(),
  ratePlan: ratePlanSchema.nullable(),
  refundable: z.boolean(),
  origin: z.string().nullable(),
  destination: z.string().nullable(),
  propertyName: z.string().nullable(),
  checkIn: calendarDateSchema.nullable(),
  checkOut: calendarDateSchema.nullable(),
  departAt: instantSchema.nullable(),
  returnAt: instantSchema.nullable(),
  travelers: z.number().int(),
  paidCents: z.number().int().nullable(),
  currency: z.string(),
  watchEnabled: z.boolean(),
})
export type DraftBooking = z.infer<typeof draftBookingSchema>

export const mailBookingDraftSchema = z.object({
  id: z.uuid(),
  /** Gmail's id for the message. */
  messageId: z.string(),
  receivedAt: instantSchema,
  senderDomain: z.string(),
  subject: z.string(),
  /** Null when what was read can no longer be understood. Dismiss it. */
  booking: draftBookingSchema.nullable(),
  /** What to fix before it can be saved, by field. Empty when it's ready. */
  problems: z.record(z.string(), z.array(z.string())),
  createdAt: instantSchema,
})
export type MailBookingDraft = z.infer<typeof mailBookingDraftSchema>

export const mailDraftParamsSchema = z.object({ draftId: z.uuid() })

/** The signed-in person's linked Gmail, or null. */
export const getMailLink = defineEndpoint({
  method: 'GET',
  path: '/api/v1/mail/link',
  response: z.object({ link: mailLinkSchema.nullable() }),
})

/** Unlinks your Gmail and revokes Ghar's access. Drafts already made stay to review. */
export const deleteMailLink = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/mail/link',
  response: z.object({ unlinked: z.literal(true) }),
})

/** Checks your Gmail for new confirmations now, instead of waiting for the morning. */
export const checkMail = defineEndpoint({
  method: 'POST',
  path: '/api/v1/mail/check',
  response: z.object({ result: mailCheckResultSchema }),
})

/** Your drafts waiting for review, newest email first. */
export const listMailBookingDrafts = defineEndpoint({
  method: 'GET',
  path: '/api/v1/mail/drafts',
  query: pageQuerySchema,
  response: pageSchema(mailBookingDraftSchema),
})

export const getMailBookingDraft = defineEndpoint({
  method: 'GET',
  path: '/api/v1/mail/drafts/:draftId',
  params: mailDraftParamsSchema,
  response: z.object({ draft: mailBookingDraftSchema }),
})

/** Saves the booking as you confirmed or corrected it. */
export const confirmMailBookingDraft = defineEndpoint({
  method: 'POST',
  path: '/api/v1/mail/drafts/:draftId/confirm',
  params: mailDraftParamsSchema,
  body: bookingBodySchema,
  response: z.object({ booking: bookingSchema }),
})

export const dismissMailBookingDraft = defineEndpoint({
  method: 'POST',
  path: '/api/v1/mail/drafts/:draftId/dismiss',
  params: mailDraftParamsSchema,
  response: z.object({ draftId: z.uuid() }),
})

/**
 * Starts linking the signed-in person's Gmail, read-only, from the phone, where the browser shares no
 * cookies with the app. The URL's state is signed and names who asked, and only that person can
 * finish. Owners, adults and members.
 */
export const authorizeMailLink = defineEndpoint({
  method: 'POST',
  path: '/api/v1/mail/link/authorize',
  body: linkAuthorizationBodySchema,
  response: linkAuthorizationSchema,
})

/**
 * Finishes linking Gmail, read-only, with the handoff the app received. Only the person who started,
 * in the same household, can use it: anyone else gets 403. An expired, changed or already used
 * handoff gets 400; start linking again. Reads no mail yet. Owners, adults and members.
 */
export const completeMailLink = defineEndpoint({
  method: 'POST',
  path: '/api/v1/mail/link/complete',
  body: linkCompletionBodySchema,
  response: z.object({ status: z.literal('connected'), link: mailLinkSchema }),
})
