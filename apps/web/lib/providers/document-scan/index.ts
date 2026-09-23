import 'server-only'
import { env } from '@/lib/env'
import { createAnthropicDocumentScanner } from './anthropic'
import { createFakeDocumentScanner } from './fake'
import type { DocumentScanner } from './types'

export { SCAN_MODEL } from './anthropic'
export { createFakeDocumentScanner } from './fake'
export { ScanError, type DocumentScanner, type FileForScan } from './types'

/** Without ANTHROPIC_API_KEY, local development reads labelled sample files with a canned reader. */
export function getDocumentScanner(): DocumentScanner {
  const { ANTHROPIC_API_KEY } = env()
  if (!ANTHROPIC_API_KEY) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ANTHROPIC_API_KEY is not set, and production cannot read scans with the sample reader.')
    }
    return createFakeDocumentScanner()
  }
  return createAnthropicDocumentScanner({ apiKey: ANTHROPIC_API_KEY })
}
