import { linkBookingToTrip } from '@casa/contracts';
import { linkBookingToTrip as link } from '@casa/db/queries';
import { authedRoute } from '@/lib/api/authed';
import { getDb } from '@/lib/db';
import { toBooking } from '@/lib/travel/serialize';

export const POST = authedRoute(
  linkBookingToTrip,
  async ({ params, body }, { context, household }) => {
    const { booking, item } = await link(getDb(), context, params.tripId, body.bookingId, {
      timeZone: household.timeZone,
      generateItineraryItem: body.generateItineraryItem,
    });
    return { booking: toBooking(booking), itineraryItemId: item?.id ?? null };
  },
);
