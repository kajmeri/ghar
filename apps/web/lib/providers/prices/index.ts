import 'server-only'
import { env } from '@/lib/env'
import { createUnconnectedExactProvider } from './exact'
import { createFakePriceProvider } from './fake'
import { createTravelpayoutsProvider } from './travelpayouts'
import type { PriceProviders } from './types'

export { fakePriceStore, type FakePrice, type FakePriceStore } from './fake'
export { PriceLookupError, type PricedBooking, type PriceProvider, type PriceProviders } from './types'

/** Without a Travelpayouts token, local development quotes made-up prices. */
export function usesFakePrices(): boolean {
  return !env().TRAVELPAYOUTS_TOKEN
}

/**
 * Whether the daily fare watch has somewhere to get prices. Production without a token has
 * nowhere, so the job skips itself until one is set instead of failing every day.
 */
export function canWatchPrices(): boolean {
  return Boolean(env().TRAVELPAYOUTS_TOKEN) || process.env.NODE_ENV !== 'production'
}

export function getPriceProviders(): PriceProviders {
  const { TRAVELPAYOUTS_TOKEN } = env()
  if (!TRAVELPAYOUTS_TOKEN) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('TRAVELPAYOUTS_TOKEN is not set, and production cannot watch made-up prices.')
    }
    return {
      tripwire: createFakePriceProvider('cached'),
      verifier: createFakePriceProvider('exact'),
    }
  }
  return {
    tripwire: createTravelpayoutsProvider({ token: TRAVELPAYOUTS_TOKEN }),
    verifier: createUnconnectedExactProvider(),
  }
}
