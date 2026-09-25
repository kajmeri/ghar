import 'server-only'
import { env } from '@/lib/env'
import { createAnthropicQuickLogReader } from './anthropic'
import { createFakeQuickLogReader } from './fake'
import type { QuickLogReader } from './types'

export { createFakeQuickLogReader } from './fake'
export { QuickLogError, type QuickLogReader } from './types'

/** Without ANTHROPIC_API_KEY, local development reads sentences with simple word matching. */
export function getQuickLogReader(): QuickLogReader {
  const { ANTHROPIC_API_KEY } = env()
  if (!ANTHROPIC_API_KEY) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ANTHROPIC_API_KEY is not set, and production cannot read the quick log with the stand-in.')
    }
    return createFakeQuickLogReader()
  }
  return createAnthropicQuickLogReader({ apiKey: ANTHROPIC_API_KEY })
}
