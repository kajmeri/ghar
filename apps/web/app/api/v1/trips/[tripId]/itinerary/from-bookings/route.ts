import { generateItineraryFromBookings } from '@casa/contracts';
import { authedRoute } from '@/lib/api/authed';
import { toItineraryItem } from '@/lib/travel/serialize';
import { generateItineraryFromBookings as generate } from '@/lib/travel/service';

export const POST = authedRoute(
  generateItineraryFromBookings,
  async ({ params, body }, session) => {
    const result = await generate(session, params.tripId, body.bookingIds);
    return { ...result, items: result.items.map(toItineraryItem) };
  },
);
