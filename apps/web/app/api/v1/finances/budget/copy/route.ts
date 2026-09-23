import { copyPreviousBudget } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { copyPreviousMonth } from '@/lib/finances/budget'

/** Brings last month's lines across, leaving alone any this month already has. */
export const POST = authedRoute(copyPreviousBudget, ({ body }, session) => copyPreviousMonth(session, body))
