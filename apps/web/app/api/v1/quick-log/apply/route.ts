import { applyQuickLog } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as quickLog from '@/lib/quick-log/service'

// Records a suggestion the person confirmed, and answers with what undoes it.
export const POST = authedRoute(applyQuickLog, ({ body }, session) => quickLog.applyQuickLog(session, body))
