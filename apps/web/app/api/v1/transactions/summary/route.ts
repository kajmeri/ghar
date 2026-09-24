import { getTransactionSummary } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { loadTransactionSummary } from '@/lib/finances/transactions'

/** What a filtered list adds up to, and the same filter month by month over the last year. */
export const GET = authedRoute(getTransactionSummary, ({ query }, session) => loadTransactionSummary(session, query))
