import { getTripBudget } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { loadTripBudget } from '@/lib/travel/trips'

export const GET = authedRoute(getTripBudget, ({ params }, session) => loadTripBudget(session, params.tripId))
