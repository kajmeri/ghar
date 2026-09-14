import { deleteItineraryItem, updateItineraryItem } from '@ghar/contracts'
import { deleteItineraryItem as removeItem, updateItineraryItem as patchItem } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { toDate, toItineraryItem } from '@/lib/travel/serialize'

export const PATCH = authedRoute(updateItineraryItem, async ({ params, body }, { context }) => {
  const { startsAt, endsAt, ...rest } = body
  const item = await patchItem(context, getDb(), params.tripId, params.itemId, {
    ...rest,
    // An absent key leaves the column alone; an explicit null clears it.
    ...(startsAt === undefined ? {} : { startsAt: toDate(startsAt) }),
    ...(endsAt === undefined ? {} : { endsAt: toDate(endsAt) }),
  })
  return { item: toItineraryItem(item) }
})

export const DELETE = authedRoute(deleteItineraryItem, async ({ params }, { context }) => {
  await removeItem(context, getDb(), params.tripId, params.itemId)
  return { deleted: true } as const
})
