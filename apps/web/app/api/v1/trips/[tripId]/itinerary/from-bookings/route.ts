import { generateItineraryFromBookings } from '@ghar/contracts';
import { generateItineraryFromBookings as generate } from '@ghar/db/queries';
import { authedRoute } from '@/lib/api/authed';
import { getDb } from '@/lib/db';
import { toItineraryItem } from '@/lib/travel/serialize';

export const POST = authedRoute(
  generateItineraryFromBookings,
  async ({ params, body }, { context, household }) => {
    const result = await generate(context, getDb(), params.tripId, {
      timeZone: household.timeZone,
      bookingIds: body.bookingIds,
    });
    return { ...result, items: result.items.map(toItineraryItem) };
  },
);
