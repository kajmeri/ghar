import { createTripLink, deleteTripLink, updateTripLink } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as guests from '@/lib/travel/guests'

export const POST = authedRoute(
  createTripLink,
  async ({ params, body }, { context }) => ({ link: await guests.createTripLink(context, params.tripId, body) }),
  { status: 201 }
)

export const PATCH = authedRoute(updateTripLink, async ({ params, body }, { context }) => ({
  link: await guests.setTripLinkApproval(context, params.tripId, body.requiresApproval),
}))

export const DELETE = authedRoute(deleteTripLink, ({ params }, { context }) => guests.deleteTripLink(context, params.tripId))
