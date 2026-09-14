import type { CalendarDate } from '../dates'
import type { Cents } from '../money'

export const BOOKING_KINDS = ['flight', 'hotel', 'car'] as const
export type BookingKind = (typeof BOOKING_KINDS)[number]

/** Only `booked` is watched. Cancelled and completed bookings stay for the record. */
export const BOOKING_STATUSES = ['booked', 'cancelled', 'completed'] as const
export type BookingStatus = (typeof BOOKING_STATUSES)[number]

/**
 * How a stay or rental is paid. `pay_at_property` is pay at pick-up for a car. Flights leave it
 * null and say whether the ticket is refundable instead.
 */
export const RATE_PLANS = ['prepaid', 'pay_at_property', 'refundable'] as const
export type RatePlan = (typeof RATE_PLANS)[number]

export const BOOKING_SOURCES = ['manual', 'email'] as const
export type BookingSource = (typeof BOOKING_SOURCES)[number]

/** Cheapest first. */
export const CABINS = ['basic_economy', 'economy', 'premium_economy', 'business', 'first'] as const
export type Cabin = (typeof CABINS)[number]

/**
 * `cached` comes from aggregated fare data: cheap, often stale, and never alerted on.
 * `exact` is a live quote from the source for this booking.
 */
export const PRICE_CONFIDENCES = ['cached', 'exact'] as const
export type PriceConfidence = (typeof PRICE_CONFIDENCES)[number]

/** What to do with a verified, capturable drop. */
export const DROP_ACTIONS = ['rebook', 'call', 'claim_credit'] as const
export type DropAction = (typeof DROP_ACTIONS)[number]

/**
 * Everything a person enters about a booking. Which fields apply depends on the kind:
 *
 * - flight: origin and destination airports, carrier, cabin, departAt, optional returnAt
 * - hotel: propertyName, destination (the city), checkIn and checkOut, ratePlan
 * - car: providerName (the rental company), origin (pick-up), optional destination (drop-off),
 *   checkIn and checkOut as the pick-up and drop-off dates, ratePlan
 *
 * `paidCents` is the total for everyone on the booking, in `currency`.
 */
export interface BookingFields {
  kind: BookingKind
  status: BookingStatus
  confirmationCode: string | null
  /** Who it was booked through: the airline, a hotel chain, an agency. The rental company for a car. */
  providerName: string | null
  /** Two-character IATA airline code. */
  carrier: string | null
  cabin: Cabin | null
  ratePlan: RatePlan | null
  refundable: boolean
  origin: string | null
  destination: string | null
  propertyName: string | null
  checkIn: CalendarDate | null
  checkOut: CalendarDate | null
  departAt: Date | null
  returnAt: Date | null
  travelers: number
  paidCents: Cents
  currency: string
  watchEnabled: boolean
}

/** A price for a booking, as a provider quoted it. The total for everyone, in the booking's currency. */
export interface PriceQuote {
  priceCents: Cents
  confidence: PriceConfidence
  provider: string
}
