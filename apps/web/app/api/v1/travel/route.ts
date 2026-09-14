import { getTravelHub } from '@casa/contracts';
import { authedRoute } from '@/lib/api/authed';
import { loadTravelHub } from '@/lib/travel/service';

export const GET = authedRoute(getTravelHub, (_input, session) => loadTravelHub(session));
