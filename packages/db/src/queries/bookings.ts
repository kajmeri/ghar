import 'server-only';
import type { RequestContext } from '@casa/contracts';
import type { TimeZone } from '@casa/core/dates';
import { NotFoundError } from '@casa/core/errors';
import { type BookingKind, itineraryDraftFromBooking } from '@casa/core/itinerary';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Database } from '../index';
import { bookings } from '../schema';
import {
  deleteItemsForBookings,
  insertGeneratedItems,
  type ItineraryItemRow,
} from './itinerary';
import { requireTrip } from './scope';

export type BookingRow = typeof bookings.$inferSelect;

export interface ListBookingsOptions {
  readonly filed?: 'unlinked' | 'linked' | 'all';
  readonly tripId?: string;
}

export async function listBookings(
  db: Database,
  ctx: RequestContext,
  { filed = 'all', tripId }: ListBookingsOptions = {},
): Promise<BookingRow[]> {
  const filedFilter =
    filed === 'unlinked'
      ? isNull(bookings.tripId)
      : filed === 'linked'
        ? isNotNull(bookings.tripId)
        : undefined;

  return db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.householdId, ctx.householdId),
        filedFilter,
        tripId ? eq(bookings.tripId, tripId) : undefined,
      ),
    )
    .orderBy(bookings.startsAt, bookings.createdAt);
}

export interface CreateBookingInput {
  readonly kind: BookingKind;
  readonly title: string;
  readonly provider: string | null;
  readonly confirmationCode: string | null;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly origin: string | null;
  readonly destination: string | null;
  readonly address: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly costCents: number | null;
  readonly url: string | null;
  readonly notes: string | null;
  readonly tripId: string | null;
}

export async function createBooking(
  db: Database,
  ctx: RequestContext,
  input: CreateBookingInput,
): Promise<BookingRow> {
  // A trip id from a request body is never trusted on its own.
  if (input.tripId) await requireTrip(db, ctx, input.tripId);

  const [booking] = await db
    .insert(bookings)
    .values({ householdId: ctx.householdId, ...input })
    .returning();
  if (!booking) throw new Error('The booking was not created');
  return booking;
}

export async function requireBooking(
  db: Database,
  ctx: RequestContext,
  bookingId: string,
): Promise<BookingRow> {
  const [booking] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.householdId, ctx.householdId)))
    .limit(1);
  if (!booking) throw new NotFoundError('That booking does not exist');
  return booking;
}

/**
 * Filing a booking under a trip, and putting it on the timeline while we are here. The
 * item is skipped when the booking has no date and the trip has none either: there is no
 * day to hang it on, and guessing would be worse than leaving it linked but unlisted.
 */
export async function linkBookingToTrip(
  db: Database,
  ctx: RequestContext,
  tripId: string,
  bookingId: string,
  options: { timeZone: TimeZone; generateItineraryItem: boolean },
): Promise<{ booking: BookingRow; item: ItineraryItemRow | null }> {
  const trip = await requireTrip(db, ctx, tripId);
  await requireBooking(db, ctx, bookingId);

  const [booking] = await db
    .update(bookings)
    .set({ tripId, updatedAt: new Date() })
    .where(and(eq(bookings.id, bookingId), eq(bookings.householdId, ctx.householdId)))
    .returning();
  if (!booking) throw new NotFoundError('That booking does not exist');

  if (!options.generateItineraryItem) return { booking, item: null };

  const draft = itineraryDraftFromBooking(booking, {
    timeZone: options.timeZone,
    fallbackDay: trip.startsOn,
  });
  if (!draft) return { booking, item: null };

  const [item] = await insertGeneratedItems(db, tripId, [{ ...draft, notes: null }]);
  return { booking, item: item ?? null };
}

/** Taking a booking off a trip. The item generated from it goes with it. */
export async function unlinkBookingFromTrip(
  db: Database,
  ctx: RequestContext,
  tripId: string,
  bookingId: string,
): Promise<{ booking: BookingRow; removedItineraryItemCount: number }> {
  await requireTrip(db, ctx, tripId);
  const existing = await requireBooking(db, ctx, bookingId);
  if (existing.tripId !== tripId) {
    throw new NotFoundError('That booking is not on this trip');
  }

  const removedItineraryItemCount = await deleteItemsForBookings(db, tripId, [bookingId]);

  const [booking] = await db
    .update(bookings)
    .set({ tripId: null, updatedAt: new Date() })
    .where(and(eq(bookings.id, bookingId), eq(bookings.householdId, ctx.householdId)))
    .returning();
  if (!booking) throw new NotFoundError('That booking does not exist');
  return { booking, removedItineraryItemCount };
}
