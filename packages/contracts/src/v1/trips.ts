import { z } from 'zod'
import { householdRoleSchema } from '../context'
import { defineEndpoint } from '../endpoint'
import { deadlineStateSchema, itineraryResponseSchema, itinerarySlotSchema, itineraryViewSchema } from './itinerary'
import { packingItemSchema } from './packing'
import {
  calendarDateSchema,
  centsSchema,
  httpUrlSchema,
  instantSchema,
  longTextSchema,
  pageQuerySchema,
  pageSchema,
  shortTextSchema,
  tripParamsSchema,
  tripStatusSchema,
} from './shared'
import { bookingSchema } from './travel'

/**
 * A person a trip can be assigned to. `displayName` is the name on their profile; null means
 * they have not set one, and clients fall back through `memberLabel` in @ghar/core rather than
 * showing a raw user id.
 */
export const householdMemberSchema = z.object({
  userId: z.uuid(),
  displayName: z.string().nullable(),
  role: householdRoleSchema,
})
export type HouseholdMember = z.infer<typeof householdMemberSchema>

/**
 * A trip as it crosses the wire. Dates are a matched pair: both set once the trip has
 * dates, both null while it is still an idea. Clients derive phase, countdown and budget
 * state from these with @ghar/core rather than the server sending prose.
 */
export const tripSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  destination: z.string().nullable(),
  startsOn: calendarDateSchema.nullable(),
  endsOn: calendarDateSchema.nullable(),
  status: tripStatusSchema,
  coverImageUrl: z.string().nullable(),
  budgetCents: centsSchema.nullable(),
  notes: z.string().nullable(),
  memberUserIds: z.array(z.uuid()),
  createdAt: instantSchema,
  updatedAt: instantSchema,
})
export type Trip = z.infer<typeof tripSchema>

/** A trip in a list: the trip, plus the counts a card shows without opening it. */
export const tripSummarySchema = tripSchema.extend({
  slotCount: z.int().nonnegative(),
  /** Slots still open: being debated, or waiting for a first option. */
  openDecisionCount: z.int().nonnegative(),
  bookingCount: z.int().nonnegative(),
  packedCount: z.int().nonnegative(),
  packingItemCount: z.int().nonnegative(),
})
export type TripSummary = z.infer<typeof tripSummarySchema>

export const createTripBodySchema = z
  .object({
    name: shortTextSchema,
    destination: shortTextSchema.nullable().default(null),
    status: tripStatusSchema.default('idea'),
    coverImageUrl: httpUrlSchema.nullable().default(null),
    budgetCents: centsSchema.nonnegative().nullable().default(null),
    notes: longTextSchema.nullable().default(null),
    /** Who is going. Whoever creates the trip is added whatever this says. */
    memberUserIds: z.array(z.uuid()).max(20).default([]),
    startsOn: calendarDateSchema.nullable().default(null),
    endsOn: calendarDateSchema.nullable().default(null),
  })
  // Dates are a matched pair, as on the table's check constraint.
  .refine(({ startsOn, endsOn }) => (startsOn === null) === (endsOn === null), 'Give a trip both dates or neither')
  .refine(({ startsOn, endsOn }) => startsOn === null || endsOn === null || endsOn >= startsOn, 'A trip cannot end before it starts')

export const updateTripBodySchema = z
  .object({
    name: shortTextSchema.optional(),
    destination: shortTextSchema.nullable().optional(),
    status: tripStatusSchema.optional(),
    coverImageUrl: httpUrlSchema.nullable().optional(),
    budgetCents: centsSchema.nonnegative().nullable().optional(),
    notes: longTextSchema.nullable().optional(),
    memberUserIds: z.array(z.uuid()).max(20).optional(),
    startsOn: calendarDateSchema.nullable().optional(),
    endsOn: calendarDateSchema.nullable().optional(),
  })
  .refine(body => Object.keys(body).length > 0, 'Send at least one field to change')
  .refine(
    // Dates move together, so a patch that touches one must touch the other.
    body => 'startsOn' in body === 'endsOn' in body,
    'Change both dates together, or neither'
  )
  .refine(({ startsOn, endsOn }) => startsOn == null || endsOn == null || endsOn >= startsOn, 'A trip cannot end before it starts')
  .refine(
    ({ startsOn, endsOn }) => startsOn === undefined || endsOn === undefined || (startsOn === null) === (endsOn === null),
    'Give a trip both dates or neither'
  )

/** What one trip's page needs, in one request. */
export const tripDetailSchema = z.object({
  trip: tripSchema,
  /** The household's zone. Times render in it, and it decides which day "today" is. */
  timeZone: z.string(),
  today: calendarDateSchema,
  /** Everyone in the household, so a packing assignment can be shown as a name. */
  members: z.array(householdMemberSchema),
  itinerary: itineraryViewSchema,
  bookings: z.array(bookingSchema),
  packing: z.array(packingItemSchema),
  /** Raw budget inputs. Clients call tripBudget in @ghar/core to get the state. */
  actualCents: centsSchema,
  committedCents: centsSchema,
})
export type TripDetail = z.infer<typeof tripDetailSchema>

/** Soonest start first, then by name; trips with no dates yet last. */
export const listTrips = defineEndpoint({
  method: 'GET',
  path: '/api/v1/trips',
  query: pageQuerySchema.extend({
    status: tripStatusSchema.optional(),
    /** "upcoming" is everything not finished, which is what the hub shows. */
    phase: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
  }),
  response: pageSchema(tripSummarySchema).extend({
    today: calendarDateSchema,
    timeZone: z.string(),
  }),
})

/**
 * Every open slot, most urgent first: anything with a reservation or decide-by deadline, soonest
 * first, then whatever happens soonest. The trip, the household's members and the whole itinerary
 * come too, so a decision can be made in place with what is around it in view.
 */
export const getDecisions = defineEndpoint({
  method: 'GET',
  path: '/api/v1/trips/:tripId/decisions',
  params: tripParamsSchema,
  response: itineraryResponseSchema.extend({
    trip: tripSchema,
    /** Everyone in the household, so a vote or an assignment can be shown as a name. */
    members: z.array(householdMemberSchema),
    decisions: z.array(
      z.object({
        slotId: z.uuid(),
        deadline: z.object({ date: calendarDateSchema, state: deadlineStateSchema }).nullable(),
      })
    ),
  }),
})

export const createTrip = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips',
  body: createTripBodySchema,
  response: z.object({ trip: tripSchema }),
})

export const getTrip = defineEndpoint({
  method: 'GET',
  path: '/api/v1/trips/:tripId',
  params: tripParamsSchema,
  response: tripDetailSchema,
})

export const updateTrip = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/trips/:tripId',
  params: tripParamsSchema,
  body: updateTripBodySchema,
  response: z.object({ trip: tripSchema }),
})

export const deleteTrip = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/trips/:tripId',
  params: tripParamsSchema,
  response: z.object({ deleted: z.literal(true) }),
})

/**
 * Filing a booking under a trip. `addToItinerary` is on by default because the reason to
 * link a booking is almost always to get it onto the itinerary, where it lands as a slot
 * already booked. Turning it off leaves the booking attached to the trip and nothing more.
 */
export const linkBookingToTrip = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/bookings',
  params: tripParamsSchema,
  body: z.object({
    bookingId: z.uuid(),
    addToItinerary: z.boolean().default(true),
  }),
  response: z.object({
    booking: bookingSchema,
    /** Null when the booking has no date to put it on, or adding it was declined. */
    slot: itinerarySlotSchema.nullable(),
  }),
})

/**
 * Taking a booking off a trip. Its option goes too, and its slot if nothing else was in it;
 * a slot with other options stays, reopened.
 */
export const unlinkBookingFromTrip = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/trips/:tripId/bookings/:bookingId',
  params: tripParamsSchema.extend({ bookingId: z.uuid() }),
  response: z.object({ booking: bookingSchema, removedOptionCount: z.int().nonnegative() }),
})
