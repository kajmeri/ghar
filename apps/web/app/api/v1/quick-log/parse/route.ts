import { parseQuickLog } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as quickLog from '@/lib/quick-log/service'

// Reads a sentence into something to confirm. Writes nothing.
export const POST = authedRoute(parseQuickLog, ({ body }, session) => quickLog.parseQuickLog(session, body.text))
