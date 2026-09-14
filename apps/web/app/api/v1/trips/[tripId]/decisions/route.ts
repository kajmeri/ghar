import { getDecisions } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { loadDecisions } from '@/lib/travel/itinerary'

export const GET = authedRoute(getDecisions, ({ params }, session) => loadDecisions(session, params.tripId))
