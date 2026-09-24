import { createTripCalendarFeed, deleteTripCalendarFeed } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as guests from '@/lib/travel/guests'

export const POST = route(
  createTripCalendarFeed,
  async ({ params }) => ({ feed: await guests.createTripCalendarFeed(await requireAccountSession(), params.tripId) }),
  { status: 201 }
)

export const DELETE = route(deleteTripCalendarFeed, async ({ params }) =>
  guests.deleteTripCalendarFeed(await requireAccountSession(), params.tripId)
)
