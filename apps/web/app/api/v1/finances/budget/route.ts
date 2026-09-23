import { getBudget } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { loadBudgetMonth } from '@/lib/finances/budget'

/** One month's plan. Without a month, the household's current one. */
export const GET = authedRoute(getBudget, ({ query }, session) => loadBudgetMonth(session, query))
