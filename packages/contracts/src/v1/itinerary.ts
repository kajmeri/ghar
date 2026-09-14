import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import {
  calendarDateSchema,
  centsSchema,
  costBasisSchema,
  httpUrlSchema,
  instantSchema,
  journeyModeSchema,
  latitudeSchema,
  longTextSchema,
  longitudeSchema,
  optionSourceSchema,
  optionStatusSchema,
  optionVoteSchema,
  shortTextSchema,
  slotBandSchema,
  slotKindSchema,
  slotStatusSchema,
  timeOfDaySchema,
  tripParamsSchema,
} from './shared'

/**
 * A trip's itinerary is slots, each holding the options being chosen between. A slot with no
 * options is a gap to fill; with one chosen, it is decided; with several and none chosen, it is
 * still being argued about. Times are optional because early plans work in parts of the day.
 */

export const optionVoteRecordSchema = z.object({
  userId: z.uuid(),
  vote: optionVoteSchema,
  comment: z.string().nullable(),
})
export type OptionVoteRecord = z.infer<typeof optionVoteRecordSchema>

export const itineraryOptionSchema = z.object({
  id: z.uuid(),
  slotId: z.uuid(),
  title: z.string(),
  subtitle: z.string().nullable(),
  url: z.string().nullable(),
  imageUrl: z.string().nullable(),
  address: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  /** Per person or for the party, as `costBasis` says. `optionTotalCents` in @ghar/core reads both. */
  costCents: centsSchema.nullable(),
  costBasis: costBasisSchema,
  durationMinutes: z.int().nullable(),
  /** Wall-clock "HH:MM" where the place is. A close at or before the open runs past midnight. */
  opensAt: z.string().nullable(),
  closesAt: z.string().nullable(),
  /** Days of the week it is shut, 0 for Sunday. */
  closedDays: z.array(z.int()),
  bookingRequired: z.boolean(),
  bookingUrl: z.string().nullable(),
  bookingDeadline: calendarDateSchema.nullable(),
  confirmationCode: z.string().nullable(),
  tags: z.array(z.string()),
  source: optionSourceSchema,
  /** Set when the option came from a booking. */
  bookingId: z.uuid().nullable(),
  status: optionStatusSchema,
  sortOrder: z.int(),
  notes: z.string().nullable(),
  createdByUserId: z.uuid().nullable(),
  votes: z.array(optionVoteRecordSchema),
})
export type ItineraryOption = z.infer<typeof itineraryOptionSchema>

export const itinerarySlotSchema = z.object({
  id: z.uuid(),
  tripId: z.uuid(),
  /** Stored rather than derived from `startsAt`, so an overnight flight stays on the day you leave. */
  day: calendarDateSchema,
  band: slotBandSchema,
  kind: slotKindSchema,
  label: z.string(),
  startsAt: instantSchema.nullable(),
  endsAt: instantSchema.nullable(),
  sortOrder: z.int(),
  status: slotStatusSchema,
  chosenOptionId: z.uuid().nullable(),
  decideBy: calendarDateSchema.nullable(),
  notes: z.string().nullable(),
  /** Every option, rejected ones included: rejecting keeps an option, it only greys it out. */
  options: z.array(itineraryOptionSchema),
})
export type ItinerarySlot = z.infer<typeof itinerarySlotSchema>

// Feasibility. Worked out on the server, because a routing provider may be behind it; the
// vocabulary is @ghar/core/travel's.

export const travelEstimateSchema = z.object({
  meters: z.number().nonnegative(),
  minutes: z.number().nonnegative(),
  mode: journeyModeSchema,
  /** `estimate` from distance alone; `routed` when a routing provider worked it out. */
  source: z.enum(['estimate', 'routed']),
})
export type TravelEstimateValue = z.infer<typeof travelEstimateSchema>

export const hoursCheckSchema = z.enum(['open', 'closed_day', 'outside_hours', 'unknown'])
export const arrivalCheckSchema = z.enum(['ok', 'late', 'unknown'])
export const deadlineStateSchema = z.enum(['passed', 'soon', 'later'])
export const itineraryWarningKindSchema = z.enum(['late_arrival', 'closed', 'deadline_passed', 'deadline_soon'])

/** What an option means in place: how far from the stop before, whether it is open, when to book by. */
export const optionFactsSchema = z.object({
  optionId: z.uuid(),
  slotId: z.uuid(),
  travel: travelEstimateSchema.nullable(),
  fromTitle: z.string().nullable(),
  arrival: arrivalCheckSchema,
  gapMinutes: z.number().nullable(),
  hours: hoursCheckSchema,
  deadline: z.object({ date: calendarDateSchema, state: deadlineStateSchema }).nullable(),
})
export type OptionFactsValue = z.infer<typeof optionFactsSchema>

export const itineraryWarningSchema = z.object({
  slotId: z.uuid(),
  optionId: z.uuid().nullable(),
  kind: itineraryWarningKindSchema,
  message: z.string(),
})
export type ItineraryWarningValue = z.infer<typeof itineraryWarningSchema>

/** The itinerary as a trip page shows it. */
export const itineraryViewSchema = z.object({
  slots: z.array(itinerarySlotSchema),
  /** Days whose offer of a breakfast-lunch-dinner skeleton somebody turned down. */
  dismissedDays: z.array(calendarDateSchema),
  /** Who is going, at least one. Per-person costs multiply by it. */
  travelers: z.int().positive(),
  facts: z.array(optionFactsSchema),
  warnings: z.array(itineraryWarningSchema),
})
export type ItineraryView = z.infer<typeof itineraryViewSchema>

export const itineraryResponseSchema = itineraryViewSchema.extend({
  timeZone: z.string(),
  today: calendarDateSchema,
})
export type ItineraryResponse = z.infer<typeof itineraryResponseSchema>

// Bodies

/** Both or neither: half a coordinate is not a place, and half of opening hours is not a time. */
function bothOrNeither(a: unknown, b: unknown): boolean {
  return (a == null) === (b == null)
}

const MINUTES_IN_A_WEEK = 7 * 24 * 60

const optionFields = z.object({
  title: shortTextSchema,
  subtitle: shortTextSchema.nullable(),
  url: httpUrlSchema.nullable(),
  imageUrl: httpUrlSchema.nullable(),
  address: shortTextSchema.nullable(),
  lat: latitudeSchema.nullable(),
  lng: longitudeSchema.nullable(),
  costCents: centsSchema.nonnegative().nullable(),
  costBasis: costBasisSchema,
  durationMinutes: z.int().positive().max(MINUTES_IN_A_WEEK).nullable(),
  opensAt: timeOfDaySchema.nullable(),
  closesAt: timeOfDaySchema.nullable(),
  closedDays: z.array(z.int().min(0).max(6)).max(7),
  bookingRequired: z.boolean(),
  bookingUrl: httpUrlSchema.nullable(),
  bookingDeadline: calendarDateSchema.nullable(),
  confirmationCode: z.string().trim().min(1).max(40).nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  notes: longTextSchema.nullable(),
})

/**
 * Only a title is needed; everything else is behind "More details". `choose` settles the slot on
 * this option in the same request, for the common case of adding the one thing you already know.
 */
export const createOptionBodySchema = optionFields
  .partial()
  .extend({
    title: shortTextSchema,
    source: z.enum(['manual', 'link']).default('manual'),
    choose: z.boolean().default(false),
  })
  .refine(({ lat, lng }) => bothOrNeither(lat, lng), 'Give both a latitude and a longitude')
  .refine(({ opensAt, closesAt }) => bothOrNeither(opensAt, closesAt), 'Give both an opening and a closing time')
export type CreateOptionBody = z.infer<typeof createOptionBodySchema>

export const updateOptionBodySchema = optionFields
  .partial()
  .refine(body => Object.keys(body).length > 0, 'Send at least one field to change')
  .refine(
    ({ lat, lng }) => (lat === undefined) === (lng === undefined) && bothOrNeither(lat, lng),
    'Change a latitude and a longitude together'
  )
  .refine(
    ({ opensAt, closesAt }) => (opensAt === undefined) === (closesAt === undefined) && bothOrNeither(opensAt, closesAt),
    'Change opening and closing times together'
  )
export type UpdateOptionBody = z.infer<typeof updateOptionBodySchema>

const endsAfterStart = ({ startsAt, endsAt }: { startsAt?: string | null; endsAt?: string | null }) =>
  startsAt == null || endsAt == null || endsAt >= startsAt

/** A slot needs somewhere on the day: a part of it, or a time the part can be worked out from. */
export const createSlotBodySchema = z
  .object({
    day: calendarDateSchema,
    band: slotBandSchema.optional(),
    kind: slotKindSchema.default('activity'),
    label: shortTextSchema,
    startsAt: instantSchema.nullable().default(null),
    endsAt: instantSchema.nullable().default(null),
    decideBy: calendarDateSchema.nullable().default(null),
    notes: longTextSchema.nullable().default(null),
  })
  .refine(({ band, startsAt }) => band !== undefined || startsAt !== null, 'Give the slot a time or a part of the day')
  .refine(endsAfterStart, 'A slot cannot end before it starts')
export type CreateSlotBody = z.infer<typeof createSlotBodySchema>

export const updateSlotBodySchema = z
  .object({
    day: calendarDateSchema.optional(),
    band: slotBandSchema.optional(),
    kind: slotKindSchema.optional(),
    label: shortTextSchema.optional(),
    startsAt: instantSchema.nullable().optional(),
    endsAt: instantSchema.nullable().optional(),
    decideBy: calendarDateSchema.nullable().optional(),
    notes: longTextSchema.nullable().optional(),
  })
  .refine(body => Object.keys(body).length > 0, 'Send at least one field to change')
  .refine(endsAfterStart, 'A slot cannot end before it starts')
export type UpdateSlotBody = z.infer<typeof updateSlotBodySchema>

/**
 * A drag in the week grid, or "Move to" on a phone. `toIndex` is where in the destination day and
 * part of the day it lands; leave it out to put the slot at the end.
 */
export const moveSlotBodySchema = z.object({
  day: calendarDateSchema,
  band: slotBandSchema,
  toIndex: z.int().nonnegative().optional(),
})

/** A null vote takes yours back. */
export const voteOnOptionBodySchema = z.object({
  vote: optionVoteSchema.nullable(),
  comment: z.string().trim().max(500).nullable().optional(),
})

const slotParamsSchema = tripParamsSchema.extend({ slotId: z.uuid() })
const optionParamsSchema = tripParamsSchema.extend({ optionId: z.uuid() })
const dayBodySchema = z.object({ day: calendarDateSchema })
const slotResponseSchema = z.object({ slot: itinerarySlotSchema })

// Reading

export const getItinerary = defineEndpoint({
  method: 'GET',
  path: '/api/v1/trips/:tripId/itinerary',
  params: tripParamsSchema,
  response: itineraryResponseSchema,
})

/**
 * Every open slot, most urgent first: anything with a reservation or decide-by deadline, soonest
 * first, then whatever happens soonest. The whole itinerary comes too, so a decision can be made
 * in place with what is around it in view.
 */
export const getDecisions = defineEndpoint({
  method: 'GET',
  path: '/api/v1/trips/:tripId/decisions',
  params: tripParamsSchema,
  response: itineraryResponseSchema.extend({
    decisions: z.array(
      z.object({
        slotId: z.uuid(),
        deadline: z.object({ date: calendarDateSchema, state: deadlineStateSchema }).nullable(),
      })
    ),
  }),
})

// Slots

export const createSlot = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/itinerary/slots',
  params: tripParamsSchema,
  body: createSlotBodySchema,
  response: slotResponseSchema,
})

export const updateSlot = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/trips/:tripId/itinerary/slots/:slotId',
  params: slotParamsSchema,
  body: updateSlotBodySchema,
  response: slotResponseSchema,
})

export const deleteSlot = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/trips/:tripId/itinerary/slots/:slotId',
  params: slotParamsSchema,
  response: z.object({ deleted: z.literal(true) }),
})

/** The whole itinerary comes back, so a client never has to guess at the new order. */
export const moveSlot = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/itinerary/slots/:slotId/move',
  params: slotParamsSchema,
  body: moveSlotBodySchema,
  response: itineraryResponseSchema,
})

/** Undoes a choice or a skip. Every option goes back to being a candidate, rejected ones aside. */
export const reopenSlot = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/itinerary/slots/:slotId/reopen',
  params: slotParamsSchema,
  response: slotResponseSchema,
})

/** Not doing this one. The slot stays, quiet, so the decision is on record. */
export const skipSlot = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/itinerary/slots/:slotId/skip',
  params: slotParamsSchema,
  response: slotResponseSchema,
})

// Options

export const createOption = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/itinerary/slots/:slotId/options',
  params: slotParamsSchema,
  body: createOptionBodySchema,
  response: slotResponseSchema,
})

/**
 * The quickest way in: paste a link. The page's OpenGraph tags fill in the title and image, read
 * the same way the idea board reads them. A page that will not say what it is still becomes an
 * option, titled with its address.
 */
export const createOptionFromLink = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/itinerary/slots/:slotId/options/from-link',
  params: slotParamsSchema,
  body: z.object({ url: httpUrlSchema, choose: z.boolean().default(false) }),
  response: slotResponseSchema,
})

/** Brings an idea off the board with its link and picture. The idea stays on the board. */
export const createOptionFromIdea = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/itinerary/slots/:slotId/options/from-idea',
  params: slotParamsSchema,
  body: z.object({ ideaId: z.uuid() }),
  response: slotResponseSchema,
})

export const updateOption = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/trips/:tripId/itinerary/options/:optionId',
  params: optionParamsSchema,
  body: updateOptionBodySchema,
  response: slotResponseSchema,
})

/** Deleting is for mistakes. To rule an option out, reject it. */
export const deleteOption = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/trips/:tripId/itinerary/options/:optionId',
  params: optionParamsSchema,
  response: slotResponseSchema,
})

/** Settles the slot on this option. Choosing another later swaps the choice. */
export const chooseOption = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/itinerary/options/:optionId/choose',
  params: optionParamsSchema,
  response: slotResponseSchema,
})

/** Rules an option out without deleting it. Rejecting the choice reopens the slot. */
export const rejectOption = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/itinerary/options/:optionId/reject',
  params: optionParamsSchema,
  response: slotResponseSchema,
})

export const restoreOption = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/itinerary/options/:optionId/restore',
  params: optionParamsSchema,
  response: slotResponseSchema,
})

export const voteOnOption = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/trips/:tripId/itinerary/options/:optionId/vote',
  params: optionParamsSchema,
  body: voteOnOptionBodySchema,
  response: slotResponseSchema,
})

// Filling days in

/**
 * Lays breakfast, lunch and dinner, and a morning, afternoon and evening, onto one day. Anything
 * the day already has under the same name is left alone, so asking twice adds nothing.
 */
export const scaffoldDay = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/itinerary/scaffold',
  params: tripParamsSchema,
  body: dayBodySchema,
  response: z.object({ slots: z.array(itinerarySlotSchema) }),
})

export const dismissScaffold = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/itinerary/scaffold/dismiss',
  params: tripParamsSchema,
  body: dayBodySchema,
  response: z.object({ dismissed: z.literal(true) }),
})

/**
 * Fills the itinerary in from the trip's linked bookings, each as a slot already booked. Idempotent:
 * a booking that is already on the itinerary is left alone.
 */
export const generateItineraryFromBookings = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/itinerary/from-bookings',
  params: tripParamsSchema,
  body: z.object({
    /** Limit it to these bookings. Omit to sweep every linked booking. */
    bookingIds: z.array(z.uuid()).max(100).optional(),
  }),
  response: itineraryResponseSchema.extend({
    createdCount: z.int().nonnegative(),
    /** Bookings with no date to put them on, and so nowhere to go on the itinerary. */
    skippedBookingIds: z.array(z.uuid()),
  }),
})
