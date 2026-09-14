import { createPackingItem, listPacking } from '@casa/contracts';
import { createPackingItem as insertItem, listPackingItems } from '@casa/db/queries';
import { authedRoute } from '@/lib/api/authed';
import { getDb } from '@/lib/db';
import { toPackingItem } from '@/lib/travel/serialize';

export const GET = authedRoute(listPacking, async ({ params }, { context }) => ({
  items: (await listPackingItems(getDb(), context, params.tripId)).map(toPackingItem),
}));

export const POST = authedRoute(
  createPackingItem,
  async ({ params, body }, { context }) => ({
    item: toPackingItem(await insertItem(getDb(), context, params.tripId, body)),
  }),
  { status: 201 },
);
