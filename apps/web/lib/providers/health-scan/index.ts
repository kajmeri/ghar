import 'server-only'
import { env } from '@/lib/env'
import { createAnthropicHealthScanner } from './anthropic'
import { createFakeHealthScanner } from './fake'
import type { HealthRecordScanner } from './types'

export { createFakeHealthScanner } from './fake'
export type { HealthRecordScanner } from './types'

/** Without ANTHROPIC_API_KEY, local development reads labelled sample files with a canned reader. */
export function getHealthScanner(): HealthRecordScanner {
  const { ANTHROPIC_API_KEY } = env()
  if (!ANTHROPIC_API_KEY) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ANTHROPIC_API_KEY is not set, and production cannot read health records with the sample reader.')
    }
    return createFakeHealthScanner()
  }
  return createAnthropicHealthScanner({ apiKey: ANTHROPIC_API_KEY })
}
