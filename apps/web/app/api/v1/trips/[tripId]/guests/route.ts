import { inviteTripGuests, listTripGuests } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { route } from '@/lib/api/handler'
import { getRequestContext, requireSession } from '@/lib/auth/context'
import * as guests from '@/lib/travel/guests'

export const GET = authedRoute(listTripGuests, ({ params }, { context }) => guests.listTripGuests(context, params.tripId))

export const POST = route(
  inviteTripGuests,
  async ({ params, body }) => {
    const session = await requireSession()
    const ctx = await getRequestContext()
    return guests.inviteTripGuests(ctx, session, params.tripId, body)
  },
  { status: 201 }
)
