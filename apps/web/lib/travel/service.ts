import 'server-only';
import type { TravelHub, TravelMode, TripDetail } from '@casa/contracts';
import { todayInTimeZone } from '@casa/core/dates';
import { itineraryDraftFromBooking } from '@casa/core/itinerary';
import { tripCommittedCents } from '@casa/core/trips';
import {
  countPastTrips,
  insertGeneratedItems,
  listBookings,
  listItineraryItems,
  listPackingItems,
  listTransactions,
  listTripIdeas,
  listTrips,
  requireTrip,
  sumTripActualCents,
  getTripWithCounts,
  type ItineraryItemRow,
} from '@casa/db/queries';
import type { Session } from '../auth';
import { getDb } from '../db';
import {
  toBooking,
  toItineraryItem,
  toPackingItem,
  toTrip,
  toTripIdea,
  toTripSummary,
  toTripTransaction,
} from './serialize';

/**
 * The orchestration behind the travel feature: several queries, assembled into one answer.
 * Route handlers and Server Components both come through here, so a page and its API
 * never drift into showing different things.
 *
 * "Today" is always the household's today. The server decides it, because a phone in a
 * different zone is still on the household's trip.
 */

export async function loadTravelHub(session: Session): Promise<TravelHub> {
  const db = getDb();
  const { context, household } = session;
  const today = todayInTimeZone(household.timeZone);

  const [trips, pastTripCount, unlinkedBookings, ideas] = await Promise.all([
    listTrips(db, context, { phase: 'upcoming', today }),
    countPastTrips(db, context, today),
    listBookings(db, context, { filed: 'unlinked' }),
    listTripIdeas(db, context),
  ]);

  return {
    today,
    timeZone: household.timeZone,
    trips: trips.map(toTripSummary),
    pastTripCount,
    unlinkedBookings: unlinkedBookings.map(toBooking),
    ideas: ideas.map(toTripIdea),
  };
}

export async function loadTripDetail(session: Session, tripId: string): Promise<TripDetail> {
  const db = getDb();
  const { context, household } = session;

  const [trip, itinerary, bookings, packing, actualCents] = await Promise.all([
    getTripWithCounts(db, context, tripId),
    listItineraryItems(db, context, tripId),
    listBookings(db, context, { tripId }),
    listPackingItems(db, context, tripId),
    sumTripActualCents(db, context, tripId),
  ]);

  return {
    trip: toTrip(trip),
    timeZone: household.timeZone,
    today: todayInTimeZone(household.timeZone),
    itinerary: itinerary.map(toItineraryItem),
    bookings: bookings.map(toBooking),
    packing: packing.map(toPackingItem),
    actualCents,
    // What the plan expects to cost, from the itinerary. Bookings show up through the
    // items generated from them, so counting both would double every linked booking.
    committedCents: tripCommittedCents(itinerary),
  };
}

export async function loadTripBudget(session: Session, tripId: string) {
  const db = getDb();
  const { context } = session;

  const [trip, itinerary, actualCents, transactions] = await Promise.all([
    requireTrip(db, context, tripId),
    listItineraryItems(db, context, tripId),
    sumTripActualCents(db, context, tripId),
    listTransactions(db, context, { tripId, limit: 200 }),
  ]);

  return {
    tripId: trip.id,
    plannedCents: trip.budgetCents,
    actualCents,
    committedCents: tripCommittedCents(itinerary),
    transactions: transactions.map(toTripTransaction),
  };
}

/**
 * Travel mode gets the whole trip, not just today: a client that caches this still has
 * tomorrow when there is no signal. `generatedAt` is what a cached copy shows to say how
 * old it is.
 */
export async function loadTravelMode(session: Session, tripId: string): Promise<TravelMode> {
  const db = getDb();
  const { context, household } = session;

  const [trip, items, bookings] = await Promise.all([
    getTripWithCounts(db, context, tripId),
    listItineraryItems(db, context, tripId),
    listBookings(db, context, { tripId }),
  ]);

  return {
    trip: toTrip(trip),
    timeZone: household.timeZone,
    today: todayInTimeZone(household.timeZone),
    generatedAt: new Date().toISOString(),
    items: items.map(toItineraryItem),
    bookings: bookings.map(toBooking),
  };
}

/**
 * Fills the timeline in from the trip's linked bookings.
 *
 * Idempotent twice over: bookings that already have an item are filtered out here, and the
 * unique index on (trip_id, booking_id) catches anything that slips past a concurrent run.
 * Bookings with no date and a trip with no dates have nowhere to go, and come back as
 * skipped rather than being guessed at.
 */
export async function generateItineraryFromBookings(
  session: Session,
  tripId: string,
  bookingIds?: readonly string[],
): Promise<{ items: ItineraryItemRow[]; createdCount: number; skippedBookingIds: string[] }> {
  const db = getDb();
  const { context, household } = session;

  const trip = await requireTrip(db, context, tripId);
  const [linked, existing] = await Promise.all([
    listBookings(db, context, { tripId }),
    listItineraryItems(db, context, tripId),
  ]);

  const alreadyOnTimeline = new Set(
    existing.flatMap((item) => (item.bookingId === null ? [] : [item.bookingId])),
  );
  const wanted = bookingIds ? new Set(bookingIds) : null;

  const skippedBookingIds: string[] = [];
  const drafts = [];
  for (const booking of linked) {
    if (alreadyOnTimeline.has(booking.id)) continue;
    if (wanted && !wanted.has(booking.id)) continue;

    const draft = itineraryDraftFromBooking(booking, {
      timeZone: household.timeZone,
      fallbackDay: trip.startsOn,
    });
    if (!draft) {
      skippedBookingIds.push(booking.id);
      continue;
    }
    drafts.push({ ...draft, notes: null });
  }

  const created = await insertGeneratedItems(db, tripId, drafts);
  return {
    items: await listItineraryItems(db, context, tripId),
    createdCount: created.length,
    skippedBookingIds,
  };
}
