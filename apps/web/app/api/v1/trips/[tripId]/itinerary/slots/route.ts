import { createSlot } from '@ghar/contracts'
import { createSlot as insertSlot } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { slotInputFromBody } from '@/lib/travel/itinerary'
import { toItinerarySlot } from '@/lib/travel/serialize'

export const POST = authedRoute(
  createSlot,
  async ({ params, body }, { context, household }) => {
    const slot = await insertSlot(context, getDb(), params.tripId, slotInputFromBody(body, household.timeZone))
    return { slot: toItinerarySlot(slot) }
  },
  { status: 201 }
)
