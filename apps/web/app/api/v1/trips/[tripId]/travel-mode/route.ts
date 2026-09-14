import { getTravelMode } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { loadTravelMode } from '@/lib/travel/trips'

export const GET = authedRoute(getTravelMode, ({ params }, session) => loadTravelMode(session, params.tripId))
