import { createItineraryItem, listItinerary } from '@casa/contracts';
import { createItineraryItem as insertItem, listItineraryItems } from '@casa/db/queries';
import { authedRoute } from '@/lib/api/authed';
import { getDb } from '@/lib/db';
import { toDate, toItineraryItem } from '@/lib/travel/serialize';

export const GET = authedRoute(listItinerary, async ({ params }, { context }) => ({
  items: (await listItineraryItems(getDb(), context, params.tripId)).map(toItineraryItem),
}));

export const POST = authedRoute(
  createItineraryItem,
  async ({ params, body }, { context }) => {
    const item = await insertItem(getDb(), context, params.tripId, {
      ...body,
      startsAt: toDate(body.startsAt),
      endsAt: toDate(body.endsAt),
    });
    return { item: toItineraryItem(item) };
  },
  { status: 201 },
);
