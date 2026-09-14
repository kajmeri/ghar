import { createTransaction, listTransactions } from '@ghar/contracts'
import { createManualTransaction, listTripTransactions } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { toTripTransaction } from '@/lib/travel/serialize'

export const GET = authedRoute(listTransactions, async ({ query }, { context }) => ({
  transactions: (await listTripTransactions(context, getDb(), query)).map(toTripTransaction),
}))

export const POST = authedRoute(
  createTransaction,
  async ({ body }, { context }) => ({
    transaction: toTripTransaction(
      await createManualTransaction(context, getDb(), {
        date: body.postedOn,
        name: body.description,
        merchantName: body.merchant,
        amountCents: body.amountCents,
        tripId: body.tripId,
      })
    ),
  }),
  { status: 201 }
)
