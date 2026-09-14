import { deleteTrip, getTrip, updateTrip } from '@casa/contracts';
import { deleteTrip as removeTrip, updateTrip as patchTrip } from '@casa/db/queries';
import { authedRoute } from '@/lib/api/authed';
import { getDb } from '@/lib/db';
import { toTrip } from '@/lib/travel/serialize';
import { loadTripDetail } from '@/lib/travel/service';

export const GET = authedRoute(getTrip, ({ params }, session) =>
  loadTripDetail(session, params.tripId),
);

export const PATCH = authedRoute(updateTrip, async ({ params, body }, { context }) => ({
  trip: toTrip(await patchTrip(getDb(), context, params.tripId, body)),
}));

export const DELETE = authedRoute(deleteTrip, async ({ params }, { context }) => {
  await removeTrip(getDb(), context, params.tripId);
  return { deleted: true } as const;
});
