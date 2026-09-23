import { getDecisions } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { loadTripDecisions } from '@/lib/travel/trips'

/** What the decisions page shows: the trip, who is on it, its itinerary, and the slots still open. */
export const GET = authedRoute(getDecisions, async ({ params }, session) => {
  const { itinerary, ...rest } = await loadTripDecisions(session, params.tripId)
  return { ...itinerary, ...rest }
})
