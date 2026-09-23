import 'server-only'
import { env } from '@/lib/env'
import { createAnthropicCategorizer } from './anthropic'
import { createFakeCategorizer } from './fake'
import type { TransactionCategorizer } from './types'

export { CATEGORIZATION_MODEL } from './anthropic'
export { createFakeCategorizer } from './fake'
export { CategorizationError, type TransactionCategorizer } from './types'

/** Without ANTHROPIC_API_KEY, local development categorizes with the stand-in and its short list. */
export function getTransactionCategorizer(): TransactionCategorizer {
  const { ANTHROPIC_API_KEY } = env()
  if (!ANTHROPIC_API_KEY) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ANTHROPIC_API_KEY is not set, and production cannot categorize with the stand-in.')
    }
    return createFakeCategorizer()
  }
  return createAnthropicCategorizer({ apiKey: ANTHROPIC_API_KEY })
}
