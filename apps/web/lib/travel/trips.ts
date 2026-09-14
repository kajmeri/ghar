import 'server-only';
import type { TravelHub, TravelMode, TripDetail } from '@ghar/contracts';
import { can } from '@ghar/core/auth';
import { todayInTimeZone } from '@ghar/core/dates';
import { tripCommittedCents } from '@ghar/core/trips';
import {
  countPastTrips,
  getTripWithCounts,
  listItineraryItems,
  listMembers,
  listPackingItems,
  listTripBookings,
  listTripIdeas,
  listTripTransactions,
  listTrips,
  requireTrip,
  sumTripActualCents,
} from '@ghar/db/queries';
import type { Session } from '../api/authed';
import { getDb } from '../db';
import {
  toBooking,
  toHouseholdMember,
  toItineraryItem,
  toPackingItem,
  toTrip,
  toTripIdea,
  toTripSummary,
  toTripTransaction,
} from './serialize';

/**
 * The orchestration behind trips: several queries, assembled into one answer. Route handlers
 * and Server Components both come through here, so a page and its API never drift into
 * showing different things.
 *
 * "Today" is always the household's today. The server decides it, because a phone in a
 * different zone is still on the household's trip.
 */

export async function loadTravelHub(session: Session): Promise<TravelHub> {
  const db = getDb();
  const { context, household } = session;
  const today = todayInTimeZone(household.timeZone);

  const [trips, pastTripCount, unlinkedBookings, ideas] = await Promise.all([
    listTrips(context, db, { phase: 'upcoming', today }),
    countPastTrips(context, db, today),
    listTripBookings(context, db, { filed: 'unlinked' }),
    listTripIdeas(context, db),
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

  const [trip, members, itinerary, bookings, packing, actualCents] = await Promise.all([
    getTripWithCounts(context, db, tripId),
    listMembers(context, db),
    listItineraryItems(context, db, tripId),
    listTripBookings(context, db, { tripId }),
    listPackingItems(context, db, tripId),
    sumTripActualCents(context, db, tripId),
  ]);

  return {
    trip: toTrip(trip),
    timeZone: household.timeZone,
    today: todayInTimeZone(household.timeZone),
    members: members.map(toHouseholdMember),
    itinerary: itinerary.map(toItineraryItem),
    bookings: bookings.map(toBooking),
    packing: packing.map(toPackingItem),
    actualCents,
    // What the plan expects to cost, from the itinerary. Bookings show up through the
    // items generated from them, so counting both would double every linked booking.
    committedCents: tripCommittedCents(itinerary),
  };
}

/**
 * Planned against actual. The total is travel data, so everyone who can see the trip sees it.
 * The charges behind it are finances data, and come back empty for a role without finances.
 */
export async function loadTripBudget(session: Session, tripId: string) {
  const db = getDb();
  const { context } = session;

  const [trip, itinerary, actualCents, transactions] = await Promise.all([
    requireTrip(context, db, tripId),
    listItineraryItems(context, db, tripId),
    sumTripActualCents(context, db, tripId),
    can(context.role, 'finances.view')
      ? listTripTransactions(context, db, { tripId, limit: 200 })
      : Promise.resolve([]),
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
    getTripWithCounts(context, db, tripId),
    listItineraryItems(context, db, tripId),
    listTripBookings(context, db, { tripId }),
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
