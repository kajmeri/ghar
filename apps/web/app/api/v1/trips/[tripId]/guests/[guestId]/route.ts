import { removeTripGuest } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as guests from '@/lib/travel/guests'

export const DELETE = authedRoute(removeTripGuest, ({ params }, { context }) => guests.removeTripGuest(context, params.tripId, params.guestId))
