import { createTripRoom, listTripRooms } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as arrivals from '@/lib/travel/arrivals'

// Everyone on the trip sees the rooms; the household sets them up.

export const GET = route(listTripRooms, async ({ params }) => ({
  value: await arrivals.listTripRooms(await requireAccountSession(), params.tripId),
}))

export const POST = route(
  createTripRoom,
  async ({ params, body }) => ({ value: await arrivals.createTripRoom(await requireAccountSession(), params.tripId, body) }),
  { status: 201 }
)
