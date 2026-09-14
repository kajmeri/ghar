import { createOptionFromLink } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { addOptionFromLink } from '@/lib/travel/itinerary'
import { toItinerarySlot } from '@/lib/travel/serialize'

export const POST = authedRoute(
  createOptionFromLink,
  async ({ params, body }, session) => ({
    slot: toItinerarySlot(await addOptionFromLink(session, params.tripId, params.slotId, body)),
  }),
  { status: 201 }
)
