import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { bookingSchema } from './travel'
import { tripIdeaSchema } from './ideas'
import { itinerarySlotSchema } from './itinerary'
import { calendarDateSchema, centsSchema, instantSchema, tripParamsSchema } from './shared'
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
  /** Every slot with its options. Travel mode and the day sheet show only what was chosen. */
  slots: z.array(itinerarySlotSchema),
  /** Linked bookings, so a confirmation code is there even for a booking not on the itinerary. */
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
