import { closeBudgetMonth } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { closeMonth } from '@/lib/finances/budget'

/** Closes a month that has ended, keeping its figures as they finished. */
export const POST = authedRoute(closeBudgetMonth, async ({ body }, session) => ({ budget: await closeMonth(session, body) }))
