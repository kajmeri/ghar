import 'server-only'
import type { BookingFields, PriceConfidence, PriceQuote } from '@ghar/core/travel'

/** What a price lookup gets to see of a booking. */
export type PricedBooking = Pick<
  BookingFields,
  | 'kind'
  | 'carrier'
  | 'cabin'
  | 'ratePlan'
  | 'origin'
  | 'destination'
  | 'propertyName'
  | 'checkIn'
  | 'checkOut'
  | 'departAt'
  | 'returnAt'
  | 'travelers'
  | 'paidCents'
  | 'currency'
> & { id: string }

/**
 * One source of prices. A tier 1 tripwire quotes `cached`; a tier 2 verifier quotes `exact`.
 * `quote` returns the total for everyone on the booking, in the booking's currency, or throws
 * PriceLookupError.
 */
export interface PriceProvider {
  readonly name: string
  readonly confidence: PriceConfidence
  /** A booking the source has no prices for is skipped, not recorded as a failed check. */
  supports(booking: PricedBooking): boolean
  quote(booking: PricedBooking): Promise<PriceQuote>
}

export interface PriceProviders {
  /** Tier 1: cheap cached prices, asked about every watched booking. */
  tripwire: PriceProvider
  /** Tier 2: an exact quote, asked only when the tripwire shows a big enough drop. */
  verifier: PriceProvider
}

/** A lookup that found no price. The message is ours, safe to store, and never a vendor body. */
export class PriceLookupError extends Error {
  override readonly name = 'PriceLookupError'
}
