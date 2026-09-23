import 'server-only'
import { env } from '@/lib/env'
import { createAnthropicBookingExtractor } from './anthropic'
import { createFakeBookingExtractor } from './fake'
import type { BookingExtractor } from './types'

export { EXTRACTION_MODEL } from './anthropic'
export { createFakeBookingExtractor, NOT_A_BOOKING } from './fake'
export { ExtractionError, type BookingExtractor, type MailForExtraction } from './types'

/** Without ANTHROPIC_API_KEY, local development reads the sample inbox with a canned reader. */
export function getBookingExtractor(): BookingExtractor {
  const { ANTHROPIC_API_KEY } = env()
  if (!ANTHROPIC_API_KEY) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ANTHROPIC_API_KEY is not set, and production cannot read mail with the sample reader.')
    }
    return createFakeBookingExtractor()
  }
  return createAnthropicBookingExtractor({ apiKey: ANTHROPIC_API_KEY })
}
