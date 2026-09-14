import { reorderItinerary } from '@casa/contracts';
import { reorderItinerary as applyReorder } from '@casa/db/queries';
import { authedRoute } from '@/lib/api/authed';
import { getDb } from '@/lib/db';
import { toItineraryItem } from '@/lib/travel/serialize';

/** A drag sends an index, the move buttons send a direction. Same edit, same endpoint. */
export const POST = authedRoute(reorderItinerary, async ({ params, body }, { context }) => ({
  items: (await applyReorder(getDb(), context, params.tripId, body)).map(toItineraryItem),
}));
