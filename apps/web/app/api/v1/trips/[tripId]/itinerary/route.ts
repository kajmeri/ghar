import { createItineraryItem, listItinerary } from '@ghar/contracts'
import { createItineraryItem as insertItem, listItineraryItems } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { toDate, toItineraryItem } from '@/lib/travel/serialize'

export const GET = authedRoute(listItinerary, async ({ params }, { context }) => ({
  items: (await listItineraryItems(context, getDb(), params.tripId)).map(toItineraryItem),
}))

export const POST = authedRoute(
  createItineraryItem,
  async ({ params, body }, { context }) => {
    const item = await insertItem(context, getDb(), params.tripId, {
      ...body,
      startsAt: toDate(body.startsAt),
      endsAt: toDate(body.endsAt),
    })
    return { item: toItineraryItem(item) }
  },
  { status: 201 }
)
