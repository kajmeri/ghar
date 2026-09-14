import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { bookingSchema } from './travel'
import { tripIdeaSchema } from './ideas'
import { itineraryItemSchema } from './itinerary'
import { calendarDateSchema, centsSchema, instantSchema, queryBooleanSchema, shortTextSchema, tripParamsSchema } from './shared'
import { tripSchema, tripSummarySchema } from './trips'

/**
 * Everything /travel shows, in one request: the trips that have not happened yet, the
 * bookings nobody has filed under one, and the idea board.
 *
 * `today` and `timeZone` come from the server because the household's zone is the one that
 * decides what day it is, not the device's. Clients feed them to @ghar/core for the
 * countdown rather than reading the phone's clock.
 */
export const travelHubSchema = z.object({
  today: calendarDateSchema,
  timeZone: z.string(),
  /** Current and upcoming, soonest first. Undated ideas come last. */
  trips: z.array(tripSummarySchema),
  pastTripCount: z.int().nonnegative(),
  /** Bookings with no trip. The hub's one piece of unfinished business. */
  unlinkedBookings: z.array(bookingSchema),
  ideas: z.array(tripIdeaSchema),
})
export type TravelHub = z.infer<typeof travelHubSchema>

export const getTravelHub = defineEndpoint({
  method: 'GET',
  path: '/api/v1/travel',
  response: travelHubSchema,
})

/**
 * Travel mode. The whole trip comes back rather than just today, so a client that caches
 * the response still has tomorrow when there is no signal. `generatedAt` is what a cached
 * copy shows to say how stale it is.
 */
export const travelModeSchema = z.object({
  trip: tripSchema,
  timeZone: z.string(),
  today: calendarDateSchema,
  generatedAt: instantSchema,
  items: z.array(itineraryItemSchema),
  /** Linked bookings, so a confirmation code is there even for a booking with no item. */
  bookings: z.array(bookingSchema),
})
export type TravelMode = z.infer<typeof travelModeSchema>

export const getTravelMode = defineEndpoint({
  method: 'GET',
  path: '/api/v1/trips/:tripId/travel-mode',
  params: tripParamsSchema,
  response: travelModeSchema,
})

export const tripTransactionSchema = z.object({
  id: z.uuid(),
  postedOn: calendarDateSchema,
  description: z.string(),
  merchant: z.string().nullable(),
  /** Negative is money out. `tripActualCents` in @ghar/core turns a list of these into spend. */
  amountCents: centsSchema,
  tripId: z.uuid().nullable(),
})
export type TripTransaction = z.infer<typeof tripTransactionSchema>

/**
 * Planned against actual. The server sends the numbers and the transactions behind them;
 * `tripBudget` in @ghar/core decides whether that reads under, close, or over.
 */
export const tripBudgetSchema = z.object({
  tripId: z.uuid(),
  plannedCents: centsSchema.nullable(),
  actualCents: centsSchema,
  committedCents: centsSchema,
  transactions: z.array(tripTransactionSchema),
})

export const getTripBudget = defineEndpoint({
  method: 'GET',
  path: '/api/v1/trips/:tripId/budget',
  params: tripParamsSchema,
  response: tripBudgetSchema,
})

/** Everyday spending, so a charge can be found and tagged to a trip. */
export const listTransactions = defineEndpoint({
  method: 'GET',
  path: '/api/v1/transactions',
  query: z.object({
    tripId: z.uuid().optional(),
    /** Only what is not tagged to any trip yet. */
    untagged: queryBooleanSchema.optional(),
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }),
  response: z.object({ transactions: z.array(tripTransactionSchema) }),
})

/**
 * A charge typed in by hand.
 *
 * The finances feature will bring these in from a bank connection and from parsed
 * receipts. Until it does, this is how a trip's actual spend gets anything to add up, and
 * it is also how you log the cash dinner no card will ever tell you about.
 *
 * `amountCents` is negative for money out, as the column is. `tripId` tags it on the way in.
 */
export const createTransaction = defineEndpoint({
  method: 'POST',
  path: '/api/v1/transactions',
  body: z.object({
    postedOn: calendarDateSchema,
    description: shortTextSchema,
    merchant: shortTextSchema.nullable().default(null),
    amountCents: centsSchema.refine(value => value !== 0, 'An amount of nothing is not a charge'),
    tripId: z.uuid().nullable().default(null),
  }),
  response: z.object({ transaction: tripTransactionSchema }),
})

/** The trip tag. Null takes a charge back off a trip. */
export const tagTransaction = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/transactions/:transactionId',
  params: z.object({ transactionId: z.uuid() }),
  body: z.object({ tripId: z.uuid().nullable() }),
  response: z.object({ transaction: tripTransactionSchema }),
})
