import { createOption } from '@ghar/contracts'
import { createOption as insertOption } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { toItinerarySlot } from '@/lib/travel/serialize'

export const POST = authedRoute(
  createOption,
  async ({ params, body }, { context }) => ({
    slot: toItinerarySlot(await insertOption(context, getDb(), params.tripId, params.slotId, body)),
  }),
  { status: 201 }
)
