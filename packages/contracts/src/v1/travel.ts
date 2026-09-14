import { z } from 'zod'
import { defineEndpoint } from '../endpoint'

// These lists mirror @ghar/core/travel. A test keeps them equal.
export const bookingKindSchema = z.enum(['flight', 'hotel', 'car'])
export const bookingStatusSchema = z.enum(['booked', 'cancelled', 'completed'])
export const ratePlanSchema = z.enum(['prepaid', 'pay_at_property', 'refundable'])
export const bookingSourceSchema = z.enum(['manual', 'email'])
export const cabinSchema = z.enum(['basic_economy', 'economy', 'premium_economy', 'business', 'first'])
export const priceConfidenceSchema = z.enum(['cached', 'exact'])
export const dropActionSchema = z.enum(['rebook', 'call', 'claim_credit'])

const calendarDateSchema = z.iso.date()
const instantSchema = z.iso.datetime({ offset: true })
const centsSchema = z.number().int()

export const bookingSchema = z.object({
  id: z.uuid(),
  kind: bookingKindSchema,
  status: bookingStatusSchema,
  confirmationCode: z.string().nullable(),
  providerName: z.string().nullable(),
  /** Two-character IATA airline code. Flights only. */
  carrier: z.string().nullable(),
  cabin: cabinSchema.nullable(),
  /** Stays and rentals only. */
  ratePlan: ratePlanSchema.nullable(),
  refundable: z.boolean(),
  /** Departure airport for a flight, pick-up location for a car. */
  origin: z.string().nullable(),
  /** Arrival airport for a flight, the city for a hotel, drop-off for a car. */
  destination: z.string().nullable(),
  propertyName: z.string().nullable(),
  checkIn: calendarDateSchema.nullable(),
  checkOut: calendarDateSchema.nullable(),
  departAt: instantSchema.nullable(),
  returnAt: instantSchema.nullable(),
  travelers: z.number().int(),
  /** The total for everyone on the booking, in `currency`. */
  paidCents: centsSchema,
  currency: z.string().length(3),
  watchEnabled: z.boolean(),
  source: bookingSourceSchema,
  tripId: z.uuid().nullable(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
})
export type Booking = z.infer<typeof bookingSchema>

export const priceSummarySchema = z.object({
  /** The most recent price found. A cached price is a hint, never a promise. */
  latest: z
    .object({
      priceCents: centsSchema,
      confidence: priceConfidenceSchema,
      checkedAt: instantSchema,
    })
    .nullable(),
  /** Latest price minus what was paid. Negative is cheaper now. */
  deltaCents: centsSchema.nullable(),
  lowestCents: centsSchema.nullable(),
  lastCheckedAt: instantSchema.nullable(),
  lastCheckFailed: z.boolean(),
})
export type PriceSummary = z.infer<typeof priceSummarySchema>

/** One price per day in the household's zone. */
export const dailyPriceSchema = z.object({
  date: calendarDateSchema,
  priceCents: centsSchema,
  confidence: priceConfidenceSchema,
})
export type DailyPrice = z.infer<typeof dailyPriceSchema>

export const bookingListItemSchema = z.object({
  booking: bookingSchema,
  price: priceSummarySchema,
  /** The last 30 days, oldest first. */
  sparkline: z.array(dailyPriceSchema),
})
export type BookingListItem = z.infer<typeof bookingListItemSchema>

export const priceCheckSchema = z.object({
  id: z.uuid(),
  checkedAt: instantSchema,
  provider: z.string(),
  priceCents: centsSchema.nullable(),
  confidence: priceConfidenceSchema,
  success: z.boolean(),
  error: z.string().nullable(),
})
export type PriceCheck = z.infer<typeof priceCheckSchema>

export const priceAlertSchema = z.object({
  id: z.uuid(),
  sentAt: instantSchema,
  priceCents: centsSchema,
  deltaCents: centsSchema,
  floorCents: centsSchema,
})
export type PriceAlert = z.infer<typeof priceAlertSchema>

export const bookingDetailSchema = z.object({
  booking: bookingSchema,
  price: priceSummarySchema,
  /** Every day with a price, oldest first. */
  history: z.array(dailyPriceSchema),
  /** The most recent checks, newest first, failures included. */
  checks: z.array(priceCheckSchema),
  /** Newest first. */
  alerts: z.array(priceAlertSchema),
  /** Whether the daily check prices it: booked, watched, and still ahead. */
  watchable: z.boolean(),
  /**
   * A verified price at or under this sends the next alert: a full step under what was paid, or
   * under the last alert. Null when a drop on this booking couldn't be captured.
   */
  alertBelowCents: centsSchema.nullable(),
  /** Whether a drop could be captured, and how. Fare rules change; the ticket's own rules count. */
  actionability: z.object({
    actionable: z.boolean(),
    action: dropActionSchema.nullable(),
    reason: z.string(),
  }),
})
export type BookingDetail = z.infer<typeof bookingDetailSchema>

const optionalTextSchema = z.string().max(200).nullable().default(null)

/**
 * What a client sends to create or replace a booking. Fields that don't apply to the kind may be
 * left out; the server clears them either way and answers 400 with `fieldErrors` for the rest.
 */
export const bookingBodySchema = z.object({
  kind: bookingKindSchema,
  status: bookingStatusSchema.default('booked'),
  confirmationCode: optionalTextSchema,
  providerName: optionalTextSchema,
  carrier: optionalTextSchema,
  cabin: cabinSchema.nullable().default(null),
  ratePlan: ratePlanSchema.nullable().default(null),
  /** Flights only. A stay or rental is refundable exactly when its rate plan is. */
  refundable: z.boolean().default(false),
  origin: optionalTextSchema,
  destination: optionalTextSchema,
  propertyName: optionalTextSchema,
  checkIn: calendarDateSchema.nullable().default(null),
  checkOut: calendarDateSchema.nullable().default(null),
  departAt: instantSchema.nullable().default(null),
  returnAt: instantSchema.nullable().default(null),
  travelers: z.number().int().default(1),
  paidCents: centsSchema,
  currency: z.string().max(3),
  watchEnabled: z.boolean().default(true),
})
export type BookingBody = z.output<typeof bookingBodySchema>

export const bookingParamsSchema = z.object({ bookingId: z.uuid() })

/** Every booking, soonest trip first, with where its price stands. */
export const listBookings = defineEndpoint({
  method: 'GET',
  path: '/api/v1/travel/bookings',
  response: z.object({ bookings: z.array(bookingListItemSchema) }),
})

export const getBooking = defineEndpoint({
  method: 'GET',
  path: '/api/v1/travel/bookings/:bookingId',
  params: bookingParamsSchema,
  response: bookingDetailSchema,
})

/** Owners, adults and members. The price watch starts on by default. */
export const createBooking = defineEndpoint({
  method: 'POST',
  path: '/api/v1/travel/bookings',
  body: bookingBodySchema,
  response: z.object({ booking: bookingSchema }),
})

/** Replaces every field. Owners, adults and members. */
export const updateBooking = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/travel/bookings/:bookingId',
  params: bookingParamsSchema,
  body: bookingBodySchema,
  response: z.object({ booking: bookingSchema }),
})

export const setBookingWatch = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/travel/bookings/:bookingId/watch',
  params: bookingParamsSchema,
  body: z.object({ watchEnabled: z.boolean() }),
  response: z.object({ booking: bookingSchema }),
})

/** Removes the booking with its price history and alerts. */
export const deleteBooking = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/travel/bookings/:bookingId',
  params: bookingParamsSchema,
  response: z.object({ bookingId: z.uuid() }),
})
