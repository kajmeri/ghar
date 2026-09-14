import { applyPackingTemplate } from '@ghar/contracts';
import { applyPackingTemplate as apply } from '@ghar/db/queries';
import { authedRoute } from '@/lib/api/authed';
import { getDb } from '@/lib/db';
import { toPackingItem } from '@/lib/travel/serialize';

export const POST = authedRoute(applyPackingTemplate, async ({ params, body }, { context }) => {
  const { items, addedCount } = await apply(context, getDb(), params.tripId, body.templateId);
  return { items: items.map(toPackingItem), addedCount };
});
