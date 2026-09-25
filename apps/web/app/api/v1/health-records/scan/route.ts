import { scanHealthRecord } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { scanHealthRecord as scan } from '@/lib/health/scan'

// Reads the shots and visits off an uploaded health record. Suggestions only; nothing is saved.
export const POST = authedRoute(scanHealthRecord, ({ body }, session) => scan(session, body))
