import { approveTripGuest } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as guests from '@/lib/travel/guests'

export const POST = authedRoute(approveTripGuest, async ({ params }, { context }) => ({
  guest: await guests.approveTripGuest(context, params.tripId, params.guestId),
}))
