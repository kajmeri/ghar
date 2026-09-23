import { createBooking, listBookings } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { getRequestContext } from '@/lib/auth/context'
import * as travel from '@/lib/travel/service'

export const GET = route(listBookings, async ({ query }) => travel.listBookingsPage(await getRequestContext(), query))

export const POST = route(
  createBooking,
  async ({ body }) => ({
    booking: await travel.createBooking(await getRequestContext(), travel.bookingFieldsFromBody(body)),
  }),
  { status: 201 }
)
