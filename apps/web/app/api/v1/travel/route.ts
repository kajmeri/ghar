import { getTravelHub } from '@ghar/contracts';
import { authedRoute } from '@/lib/api/authed';
import { loadTravelHub } from '@/lib/travel/trips';

export const GET = authedRoute(getTravelHub, (_input, session) => loadTravelHub(session));
