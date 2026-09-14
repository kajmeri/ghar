import { createBooking, listBookings } from '@casa/contracts';
import {
  createBooking as insertBooking,
  listBookings as selectBookings,
} from '@casa/db/queries';
import { authedRoute } from '@/lib/api/authed';
import { getDb } from '@/lib/db';
import { toBooking, toDate } from '@/lib/travel/serialize';

export const GET = authedRoute(listBookings, async ({ query }, { context }) => ({
  bookings: (await selectBookings(getDb(), context, query)).map(toBooking),
}));

export const POST = authedRoute(
  createBooking,
  async ({ body }, { context }) => {
    const booking = await insertBooking(getDb(), context, {
      ...body,
      startsAt: toDate(body.startsAt),
      endsAt: toDate(body.endsAt),
    });
    return { booking: toBooking(booking) };
  },
  { status: 201 },
);
