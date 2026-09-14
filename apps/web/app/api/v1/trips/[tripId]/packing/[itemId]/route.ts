import { deletePackingItem, updatePackingItem } from '@ghar/contracts'
import { deletePackingItem as removeItem, updatePackingItem as patchItem } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { toPackingItem } from '@/lib/travel/serialize'

export const PATCH = authedRoute(updatePackingItem, async ({ params, body }, { context }) => ({
  item: toPackingItem(await patchItem(context, getDb(), params.tripId, params.itemId, body)),
}))

export const DELETE = authedRoute(deletePackingItem, async ({ params }, { context }) => {
  await removeItem(context, getDb(), params.tripId, params.itemId)
  return { deleted: true } as const
})
