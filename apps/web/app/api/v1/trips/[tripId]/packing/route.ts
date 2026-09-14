import { createPackingItem, listPacking } from '@ghar/contracts';
import { createPackingItem as insertItem, listPackingItems } from '@ghar/db/queries';
import { authedRoute } from '@/lib/api/authed';
import { getDb } from '@/lib/db';
import { toPackingItem } from '@/lib/travel/serialize';

export const GET = authedRoute(listPacking, async ({ params }, { context }) => ({
  items: (await listPackingItems(context, getDb(), params.tripId)).map(toPackingItem),
}));

export const POST = authedRoute(
  createPackingItem,
  async ({ params, body }, { context }) => ({
    item: toPackingItem(await insertItem(context, getDb(), params.tripId, body)),
  }),
  { status: 201 },
);
