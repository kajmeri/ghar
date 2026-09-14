import { getTravelMode } from '@casa/contracts';
import { authedRoute } from '@/lib/api/authed';
import { loadTravelMode } from '@/lib/travel/service';

export const GET = authedRoute(getTravelMode, ({ params }, session) =>
  loadTravelMode(session, params.tripId),
);
