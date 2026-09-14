import { applyPackingTemplate } from '@casa/contracts';
import { applyPackingTemplate as apply } from '@casa/db/queries';
import { authedRoute } from '@/lib/api/authed';
import { getDb } from '@/lib/db';
import { toPackingItem } from '@/lib/travel/serialize';

export const POST = authedRoute(applyPackingTemplate, async ({ params, body }, { context }) => {
  const { items, addedCount } = await apply(getDb(), context, params.tripId, body.templateId);
  return { items: items.map(toPackingItem), addedCount };
});
