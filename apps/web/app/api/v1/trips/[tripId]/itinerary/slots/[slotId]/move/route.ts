import { moveSlot } from '@ghar/contracts'
import { moveSlot as move } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { itineraryResponse } from '@/lib/travel/itinerary'

export const POST = authedRoute(moveSlot, async ({ params, body }, session) => {
  const itinerary = await move(session.context, getDb(), params.tripId, params.slotId, body)
  return itineraryResponse(session, params.tripId, itinerary)
})
