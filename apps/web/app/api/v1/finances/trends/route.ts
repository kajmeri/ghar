import { getSpendingTrends } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { loadSpendingTrends } from '@/lib/finances/trends'

/** Spending and money in, month by month: the trends screen, and the phone's. */
export const GET = authedRoute(getSpendingTrends, ({ query }, session) => loadSpendingTrends(session, query.range))
