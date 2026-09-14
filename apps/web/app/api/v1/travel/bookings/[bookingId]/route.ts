import { deleteBooking, getBooking, updateBooking } from '@ghar/contracts';
import { route } from '@/lib/api/handler';
import { getRequestContext } from '@/lib/auth/context';
import * as travel from '@/lib/travel/service';

export const GET = route(getBooking, async ({ params }) =>
  travel.getBookingDetail(await getRequestContext(), { bookingId: params.bookingId }),
);

export const PUT = route(updateBooking, async ({ params, body }) => ({
  booking: await travel.updateBooking(await getRequestContext(), {
    ...travel.bookingFieldsFromBody(body),
    bookingId: params.bookingId,
  }),
}));

export const DELETE = route(deleteBooking, async ({ params }) =>
  travel.deleteBooking(await getRequestContext(), { bookingId: params.bookingId }),
);
