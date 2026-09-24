import { listTripPolls, openTripPoll } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as polls from '@/lib/travel/polls'

// Shared by the household and the trip's guests, so these take a session rather than a household.

export const GET = route(listTripPolls, async ({ params }) => ({
  value: await polls.listTripPolls(await requireAccountSession(), params.tripId),
}))

export const POST = route(
  openTripPoll,
  async ({ params, body }) => ({ value: await polls.openTripPoll(await requireAccountSession(), params.tripId, body) }),
  { status: 201 }
)
