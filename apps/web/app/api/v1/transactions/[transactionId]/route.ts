import { deleteTransaction, tagTransaction } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { editTransaction, removeTransaction } from '@/lib/finances/transactions'

/** A charge's category, its trip tag, whether it counts towards spending, or its note. */
export const PATCH = authedRoute(tagTransaction, async ({ params, body }, session) => ({
  transaction: await editTransaction(session, params.transactionId, body),
}))

/** A charge added by hand, taken back out. */
export const DELETE = authedRoute(deleteTransaction, ({ params }, session) => removeTransaction(session, params.transactionId))
