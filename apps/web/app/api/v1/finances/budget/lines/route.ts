import { setBudgetLine } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { saveBudgetLine } from '@/lib/finances/budget'

/** Plans a category for a month, or changes what it is planned. */
export const PUT = authedRoute(setBudgetLine, async ({ body }, session) => ({ line: await saveBudgetLine(session, body) }))
