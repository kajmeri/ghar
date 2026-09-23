import { createPackingItem, listPacking } from '@ghar/contracts'
import { createPackingItem as insertItem } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { toPackingItem } from '@/lib/travel/serialize'
import { loadPackingPage } from '@/lib/travel/trips'

export const GET = authedRoute(listPacking, ({ params, query }, session) => loadPackingPage(session, params.tripId, query))

export const POST = authedRoute(
  createPackingItem,
  async ({ params, body }, { context }) => ({
    item: toPackingItem(await insertItem(context, getDb(), params.tripId, body)),
  }),
  { status: 201 }
)
