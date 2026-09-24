import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { calendarDateSchema, instantSchema } from './shared'

// People from outside the household on a trip. The household's side lives under the trip; the
// guest's side is under /trip-invites (answering) and /shared-trips (what they were let onto),
// and needs a session but no household.

/** Mirrors GUEST_RESPONSES in @ghar/core/trip-guests. A test keeps them equal. */
export const guestResponseSchema = z.enum(['going', 'maybe', 'not_going'])
export type GuestResponseValue = z.infer<typeof guestResponseSchema>

/** invited: asked by email, no answer yet. asked: came through the link, waiting to be let in. */
export const guestStatusSchema = z.enum(['invited', 'asked', 'going', 'maybe', 'not_going'])
export type GuestStatusValue = z.infer<typeof guestStatusSchema>

export const guestSourceSchema = z.enum(['email', 'link'])

/** MAX_PARTY_SIZE and MAX_INVITE_EMAILS in @ghar/core/trip-guests. */
export const GUEST_MAX_PARTY_SIZE = 10
export const GUEST_MAX_INVITE_EMAILS = 20

export const partySizeSchema = z.coerce.number().int().min(1, 'At least 1.').max(GUEST_MAX_PARTY_SIZE, `Up to ${String(GUEST_MAX_PARTY_SIZE)}.`)

export const headcountSchema = z.object({ going: z.int(), maybe: z.int() })

export const tripGuestSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  /** From their account, once they have one and have given a name. */
  name: z.string().nullable(),
  source: guestSourceSchema,
  response: guestResponseSchema.nullable(),
  status: guestStatusSchema,
  partySize: z.int(),
  approvedAt: instantSchema.nullable(),
  respondedAt: instantSchema.nullable(),
  invitedByName: z.string().nullable(),
  createdAt: instantSchema,
})
export type TripGuest = z.infer<typeof tripGuestSchema>

export const tripLinkSchema = z.object({
  /** The whole link to share. Anyone holding it sees the invitation. */
  url: z.url(),
  /** Whether people who come through it wait for the household to let them in. */
  requiresApproval: z.boolean(),
  createdAt: instantSchema,
})
export type TripLink = z.infer<typeof tripLinkSchema>

const tripParams = z.object({ tripId: z.uuid() })
const guestParams = z.object({ tripId: z.uuid(), guestId: z.uuid() })

export const tripGuestsResponseSchema = z.object({
  guests: z.array(tripGuestSchema),
  headcount: headcountSchema,
  /** Whether the caller can invite, approve and remove. */
  canInvite: z.boolean(),
  /** The trip's link while it is on. Always null for someone who can't invite. */
  link: tripLinkSchema.nullable(),
})
export type TripGuestsValue = z.infer<typeof tripGuestsResponseSchema>

/** Everyone asked onto the trip, people waiting to be let in first. Capped at 100 guests a trip. */
export const listTripGuests = defineEndpoint({
  method: 'GET',
  path: '/api/v1/trips/:tripId/guests',
  params: tripParams,
  response: tripGuestsResponseSchema,
})

export const inviteTripGuestsBodySchema = z.object({
  emails: z
    .array(z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')))
    .min(1, 'Add at least one email address.')
    .max(GUEST_MAX_INVITE_EMAILS, `Up to ${String(GUEST_MAX_INVITE_EMAILS)} at a time.`),
})
export type InviteTripGuestsBody = z.infer<typeof inviteTripGuestsBodySchema>

/**
 * Owners and adults. Emails each new address its own link; they're let in as soon as they answer.
 * Addresses already on the list or in the household are skipped, and said so.
 */
export const inviteTripGuests = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/guests',
  params: tripParams,
  body: inviteTripGuestsBodySchema,
  response: z.object({
    invited: z.array(tripGuestSchema),
    skipped: z.array(z.object({ email: z.string(), reason: z.enum(['already_invited', 'in_household']) })),
  }),
})

/** Lets in someone who asked through the link. */
export const approveTripGuest = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/guests/:guestId/approve',
  params: guestParams,
  response: z.object({ guest: tripGuestSchema }),
})

/** Takes someone off the trip, or turns down someone who asked. Their emailed link stops working. */
export const removeTripGuest = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/trips/:tripId/guests/:guestId',
  params: guestParams,
  response: z.object({ id: z.uuid() }),
})

export const createTripLinkBodySchema = z.object({ requiresApproval: z.boolean().optional() }).prefault({})

/** Turns the link on, or makes a new one so the old one stops working. Owners and adults. */
export const createTripLink = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/link',
  params: tripParams,
  body: createTripLinkBodySchema,
  response: z.object({ link: tripLinkSchema }),
})

export const updateTripLink = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/trips/:tripId/link',
  params: tripParams,
  body: z.object({ requiresApproval: z.boolean() }),
  response: z.object({ link: tripLinkSchema }),
})

/** Turns the link off. People already on the trip stay on it. */
export const deleteTripLink = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/trips/:tripId/link',
  params: tripParams,
  response: z.object({ tripId: z.uuid() }),
})

// The guest's side --------------------------------------------------------------------------

/** The token from an emailed invitation or the trip's link. In a body, never a query string. */
export const tripInviteTokenSchema = z.string().min(32).max(128)

/** What a trip shows someone outside its household. Never money, notes or bookings. */
export const sharedTripBasicsSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  destination: z.string().nullable(),
  startsOn: calendarDateSchema.nullable(),
  endsOn: calendarDateSchema.nullable(),
  coverImageUrl: z.string().nullable(),
  householdName: z.string(),
})

export const whoIsGoingSchema = z.object({
  /** First names only. */
  names: z.array(z.string()),
  headcount: headcountSchema,
})

export const myTripAnswerSchema = z.object({
  guestId: z.uuid(),
  response: guestResponseSchema.nullable(),
  partySize: z.int(),
  status: guestStatusSchema,
})
export type MyTripAnswer = z.infer<typeof myTripAnswerSchema>

export const tripInvitePreviewSchema = z.object({
  kind: z.enum(['email', 'link']),
  trip: sharedTripBasicsSchema,
  invitedByName: z.string().nullable(),
  going: whoIsGoingSchema,
  requiresApproval: z.boolean(),
  /** The address an emailed invitation went to. Null for the link. */
  invitedEmail: z.string().nullable(),
  /** Signed in as the person it's for. Always true for the link. */
  forYou: z.boolean(),
  signedIn: z.boolean(),
  /** In the trip's own household, so there's nothing to answer. */
  inHousehold: z.boolean(),
  /** The caller's answer, when they have one. */
  mine: myTripAnswerSchema.nullable(),
  /** Signed in with no name on the account. The answer form asks for one. */
  needsName: z.boolean(),
})
export type TripInvitePreview = z.infer<typeof tripInvitePreviewSchema>

/**
 * What an invitation shows, signed in or not: the trip, dates and cover, the household's name and
 * the first names of who's going. 404 for a link that's off or an invitation that was withdrawn.
 */
export const previewTripInvite = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trip-invites/preview',
  access: 'public',
  body: z.object({ token: tripInviteTokenSchema }),
  response: z.object({ invite: tripInvitePreviewSchema }),
})

export const tripAnswerBodySchema = z.object({
  response: guestResponseSchema,
  partySize: partySizeSchema.default(1),
})

export const tripAnswerSchema = z.object({
  tripId: z.uuid(),
  guestId: z.uuid(),
  status: guestStatusSchema,
  /** False while waiting for the household to let them in. */
  admitted: z.boolean(),
})
export type TripAnswer = z.infer<typeof tripAnswerSchema>

export const respondToTripInviteBodySchema = tripAnswerBodySchema.extend({
  token: tripInviteTokenSchema,
  /** For someone whose account has no name yet, so the household knows who answered. */
  name: z.string().trim().min(1).max(100).optional(),
})
export type RespondToTripInviteBody = z.input<typeof respondToTripInviteBodySchema>

/**
 * Answers an invitation, or changes the answer. Needs a session but no household. An emailed
 * invitation needs the address it went to (403). 409 for someone in the trip's own household.
 */
export const respondToTripInvite = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trip-invites/respond',
  body: respondToTripInviteBodySchema,
  response: z.object({ answer: tripAnswerSchema }),
})

export const sharedTripSchema = sharedTripBasicsSchema.extend({ mine: myTripAnswerSchema })
export type SharedTrip = z.infer<typeof sharedTripSchema>

/** Trips other households let the caller onto, soonest first. Their own household's are never here. */
export const listSharedTrips = defineEndpoint({
  method: 'GET',
  path: '/api/v1/shared-trips',
  response: z.object({ trips: z.array(sharedTripSchema) }),
})

export const sharedTripDetailSchema = sharedTripSchema.extend({ going: whoIsGoingSchema })
export type SharedTripDetail = z.infer<typeof sharedTripDetailSchema>

/** One trip as a guest sees it. 404 for anyone not let onto it, including its own household. */
export const getSharedTrip = defineEndpoint({
  method: 'GET',
  path: '/api/v1/shared-trips/:tripId',
  params: tripParams,
  response: z.object({ trip: sharedTripDetailSchema }),
})

export const updateMyTripAnswer = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/shared-trips/:tripId/answer',
  params: tripParams,
  body: tripAnswerBodySchema,
  response: z.object({ answer: tripAnswerSchema }),
})
