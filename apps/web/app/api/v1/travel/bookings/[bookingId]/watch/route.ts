import { setBookingWatch } from '@ghar/contracts';
import { route } from '@/lib/api/handler';
import { getRequestContext } from '@/lib/auth/context';
import * as travel from '@/lib/travel/service';

export const PUT = route(setBookingWatch, async ({ params, body }) => ({
  booking: await travel.setBookingWatch(await getRequestContext(), {
    bookingId: params.bookingId,
    watchEnabled: body.watchEnabled,
  }),
}));
