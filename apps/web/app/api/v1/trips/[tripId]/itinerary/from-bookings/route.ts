import { generateItineraryFromBookings } from '@ghar/contracts'
import { generateItineraryFromBookings as generate } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { itineraryResponse } from '@/lib/travel/itinerary'

export const POST = authedRoute(generateItineraryFromBookings, async ({ params, body }, session) => {
  const { itinerary, createdCount, skippedBookingIds } = await generate(session.context, getDb(), params.tripId, {
    timeZone: session.household.timeZone,
    bookingIds: body.bookingIds,
  })
  return { ...(await itineraryResponse(session, params.tripId, itinerary)), createdCount, skippedBookingIds }
})
