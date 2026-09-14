import { unlinkBookingFromTrip } from '@ghar/contracts'
import { unlinkBookingFromTrip as unlink } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { toBooking } from '@/lib/travel/serialize'

export const DELETE = authedRoute(unlinkBookingFromTrip, async ({ params }, { context }) => {
  const { booking, removedOptionCount } = await unlink(context, getDb(), params.tripId, params.bookingId)
  return { booking: toBooking(booking), removedOptionCount }
})
