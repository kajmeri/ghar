import 'server-only'
import { env } from '@/lib/env'
import { createAnthropicArrivalExtractor } from './anthropic'
import { createFakeArrivalExtractor } from './fake'
import type { ArrivalExtractor } from './types'

export { ARRIVAL_EXTRACTION_MODEL } from './anthropic'
export { createFakeArrivalExtractor, NOT_TRAVEL } from './fake'
export { ArrivalExtractionError, type ArrivalExtractor, type ArrivalText } from './types'

/** Without ANTHROPIC_API_KEY, local development reads labelled lines with a canned reader. */
export function getArrivalExtractor(): ArrivalExtractor {
  const { ANTHROPIC_API_KEY } = env()
  if (!ANTHROPIC_API_KEY) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ANTHROPIC_API_KEY is not set, and production cannot read confirmations with the sample reader.')
    }
    return createFakeArrivalExtractor()
  }
  return createAnthropicArrivalExtractor({ apiKey: ANTHROPIC_API_KEY })
}
