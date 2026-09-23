import { createTransaction, listTransactions } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { addTransaction, loadTransactionsPage } from '@/lib/finances/transactions'

/** Everyday spending, newest first: the money screen's list, and the trip tagger's picker. */
export const GET = authedRoute(listTransactions, ({ query }, session) => loadTransactionsPage(session, query))

export const POST = authedRoute(createTransaction, async ({ body }, session) => ({ transaction: await addTransaction(session, body) }), {
  status: 201,
})
