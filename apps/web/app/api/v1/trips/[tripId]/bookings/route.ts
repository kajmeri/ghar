import { linkBookingToTrip } from '@ghar/contracts'
import { linkBookingToTrip as link } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { toBooking, toItinerarySlot } from '@/lib/travel/serialize'

export const POST = authedRoute(linkBookingToTrip, async ({ params, body }, { context, household }) => {
  const { booking, slot } = await link(context, getDb(), params.tripId, body.bookingId, {
    timeZone: household.timeZone,
    addToItinerary: body.addToItinerary,
  })
  return { booking: toBooking(booking), slot: slot ? toItinerarySlot(slot) : null }
})
