import { deletePackingItem, updatePackingItem } from '@casa/contracts';
import {
  deletePackingItem as removeItem,
  updatePackingItem as patchItem,
} from '@casa/db/queries';
import { authedRoute } from '@/lib/api/authed';
import { getDb } from '@/lib/db';
import { toPackingItem } from '@/lib/travel/serialize';

export const PATCH = authedRoute(updatePackingItem, async ({ params, body }, { context }) => ({
  item: toPackingItem(await patchItem(getDb(), context, params.tripId, params.itemId, body)),
}));

export const DELETE = authedRoute(deletePackingItem, async ({ params }, { context }) => {
  await removeItem(getDb(), context, params.tripId, params.itemId);
  return { deleted: true } as const;
});
