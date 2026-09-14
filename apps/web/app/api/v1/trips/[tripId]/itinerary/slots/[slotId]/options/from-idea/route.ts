import { createOptionFromIdea } from '@ghar/contracts'
import { createOptionFromIdea as promote } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { toItinerarySlot } from '@/lib/travel/serialize'

export const POST = authedRoute(
  createOptionFromIdea,
  async ({ params, body }, { context }) => ({
    slot: toItinerarySlot(await promote(context, getDb(), params.tripId, params.slotId, body.ideaId)),
  }),
  { status: 201 }
)
