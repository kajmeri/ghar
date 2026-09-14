import { getItinerary } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { itineraryResponse } from '@/lib/travel/itinerary'

export const GET = authedRoute(getItinerary, ({ params }, session) => itineraryResponse(session, params.tripId))
