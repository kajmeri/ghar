import { getTripBudget } from '@casa/contracts';
import { authedRoute } from '@/lib/api/authed';
import { loadTripBudget } from '@/lib/travel/service';

export const GET = authedRoute(getTripBudget, ({ params }, session) =>
  loadTripBudget(session, params.tripId),
);
