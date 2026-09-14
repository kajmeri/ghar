import { scaffoldDay } from '@ghar/contracts'
import { scaffoldDay as scaffold } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { toItinerarySlot } from '@/lib/travel/serialize'

export const POST = authedRoute(scaffoldDay, async ({ params, body }, { context }) => ({
  slots: (await scaffold(context, getDb(), params.tripId, body.day)).map(toItinerarySlot),
}))
