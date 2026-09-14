import 'server-only'
import { PriceLookupError, type PriceProvider } from './types'

/**
 * Tier 2 in production, until a live source is connected. Airlines, hotels and rental companies
 * have no public quote API, so this fails every lookup. Each tripwire hit is then recorded as a
 * failed exact check and nothing is emailed, which is the safe way to be incomplete.
 */
export function createUnconnectedExactProvider(): PriceProvider {
  return {
    name: 'unconnected',
    confidence: 'exact',
    supports: () => true,
    quote: () => Promise.reject(new PriceLookupError('Live price verification is not connected yet.')),
  }
}
