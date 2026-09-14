import { unlinkBookingFromTrip } from '@casa/contracts';
import { unlinkBookingFromTrip as unlink } from '@casa/db/queries';
import { authedRoute } from '@/lib/api/authed';
import { getDb } from '@/lib/db';
import { toBooking } from '@/lib/travel/serialize';

export const DELETE = authedRoute(unlinkBookingFromTrip, async ({ params }, { context }) => {
  const { booking, removedItineraryItemCount } = await unlink(
    getDb(),
    context,
    params.tripId,
    params.bookingId,
  );
  return { booking: toBooking(booking), removedItineraryItemCount };
});
