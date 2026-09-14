import 'server-only';
import type { Cents } from '@ghar/core/money';
import type { PriceConfidence } from '@ghar/core/travel';
import { PriceLookupError, type PriceProvider } from './types';

/**
 * A price someone set for a booking. Leave a tier out and it quotes what was paid; set `fails`
 * to make that tier's lookup throw.
 */
export interface FakePrice {
  cachedCents?: Cents;
  exactCents?: Cents;
  fails?: readonly PriceConfidence[];
}

export type FakePriceStore = Map<string, FakePrice>;

// Kept on globalThis so the dev-only simulate form and the cron route share one store across
// hot reloads.
const globalForPrices = globalThis as typeof globalThis & { gharFakePrices?: FakePriceStore };

export function fakePriceStore(): FakePriceStore {
  globalForPrices.gharFakePrices ??= new Map();
  return globalForPrices.gharFakePrices;
}

/**
 * Local development and tests. Every booking costs exactly what was paid until a price is set in
 * the store, so nothing ever drops by accident.
 */
export function createFakePriceProvider(
  confidence: PriceConfidence,
  store: FakePriceStore = fakePriceStore(),
): PriceProvider {
  return {
    name: 'fake',
    confidence,
    supports: () => true,
    quote(booking) {
      const price = store.get(booking.id);
      if (price?.fails?.includes(confidence)) {
        return Promise.reject(new PriceLookupError(`The fake ${confidence} lookup was set to fail.`));
      }
      const set = confidence === 'cached' ? price?.cachedCents : price?.exactCents;
      return Promise.resolve({ priceCents: set ?? booking.paidCents, confidence, provider: 'fake' });
    },
  };
}
