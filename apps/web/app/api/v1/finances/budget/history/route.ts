import { getBudgetHistory } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { loadBudgetHistory } from '@/lib/finances/budget'

/** The last six months, each against what it planned. */
export const GET = authedRoute(getBudgetHistory, (_request, session) => loadBudgetHistory(session))
