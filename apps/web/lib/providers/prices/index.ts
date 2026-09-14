import 'server-only'
import { env } from '@/lib/env'
import { createUnconnectedExactProvider } from './exact'
import { createFakePriceProvider } from './fake'
import { createTravelpayoutsProvider } from './travelpayouts'
import type { PriceProviders } from './types'

export { fakePriceStore, type FakePrice, type FakePriceStore } from './fake'
export { PriceLookupError, type PricedBooking, type PriceProvider, type PriceProviders } from './types'

export function usesFakePrices(): boolean {
  return env().PRICE_PROVIDER === 'fake'
}

export function getPriceProviders(): PriceProviders {
  const { PRICE_PROVIDER, TRAVELPAYOUTS_TOKEN } = env()
  if (PRICE_PROVIDER === 'fake') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('PRICE_PROVIDER is fake, and production cannot watch made-up prices.')
    }
    return {
      tripwire: createFakePriceProvider('cached'),
      verifier: createFakePriceProvider('exact'),
    }
  }
  if (!TRAVELPAYOUTS_TOKEN) {
    throw new Error('PRICE_PROVIDER is travelpayouts, but TRAVELPAYOUTS_TOKEN is not set.')
  }
  return {
    tripwire: createTravelpayoutsProvider({ token: TRAVELPAYOUTS_TOKEN }),
    verifier: createUnconnectedExactProvider(),
  }
}
