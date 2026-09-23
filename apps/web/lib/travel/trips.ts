import 'server-only'
import type { PageQuery, TravelHub, TravelMode, TripDetail } from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import { todayInTimeZone } from '@ghar/core/dates'
import { plannedCents } from '@ghar/core/itinerary'
import {
  countPastTrips,
  getTripWithCounts,
  listItinerary,
  listMembers,
  listPackingItems,
  listPackingItemsPage,
  listPackingTemplatesPage,
  listTripBookings,
  listTripIdeas,
  listTripIdeasPage,
  listTripTransactions,
  listTrips,
  listTripsPage,
  sumTripActualCents,
  type ListTripsOptions,
} from '@ghar/db/queries'
import type { Session } from '../api/authed'
import { pageRequest, pageResponse } from '../api/cursor'
import { getDb } from '../db'
import { decisionsFor, itineraryView, travelersOn } from './itinerary'
import {
  toBooking,
  toHouseholdMember,
  toItinerarySlot,
  toPackingItem,
  toPackingTemplate,
  toTrip,
  toTripIdea,
  toTripSummary,
  toTripTransaction,
} from './serialize'

/**
 * The orchestration behind trips: several queries, assembled into one answer. Route handlers
 * and Server Components both come through here, so a page and its API never drift into
 * showing different things.
 *
 * "Today" is always the household's today. The server decides it, because a phone in a
 * different zone is still on the household's trip.
 */

export async function loadTravelHub(session: Session): Promise<TravelHub> {
  const db = getDb()
  const { context, household } = session
  const today = todayInTimeZone(household.timeZone)

  const [trips, pastTripCount, unlinkedBookings, ideas] = await Promise.all([
    listTrips(context, db, { phase: 'upcoming', today }),
    countPastTrips(context, db, today),
    listTripBookings(context, db, { filed: 'unlinked' }),
    listTripIdeas(context, db),
  ])

  return {
    today,
    timeZone: household.timeZone,
    trips: trips.map(toTripSummary),
    pastTripCount,
    unlinkedBookings: unlinkedBookings.map(toBooking),
    ideas: ideas.map(toTripIdea),
  }
}

/** The household's idea board, for promoting an idea into a slot's options. */
export async function loadTripIdeas(session: Session) {
  const ideas = await listTripIdeas(session.context, getDb())
  return ideas.map(toTripIdea)
}

export async function loadTripDetail(session: Session, tripId: string): Promise<TripDetail> {
  const db = getDb()
  const { context, household } = session

  const [trip, members, itinerary, bookings, packing, actualCents] = await Promise.all([
    getTripWithCounts(context, db, tripId),
    listMembers(context, db),
    listItinerary(context, db, tripId),
    listTripBookings(context, db, { tripId }),
    listPackingItems(context, db, tripId),
    sumTripActualCents(context, db, tripId),
  ])
  const travelers = travelersOn(trip)

  return {
    trip: toTrip(trip),
    timeZone: household.timeZone,
    today: todayInTimeZone(household.timeZone),
    members: members.map(toHouseholdMember),
    itinerary: await itineraryView(itinerary, travelers, household.timeZone),
    bookings: bookings.map(toBooking),
    packing: packing.map(toPackingItem),
    actualCents,
    // What the chosen options cost. Bookings show up through the options made from them, so
    // counting both would double every linked booking.
    committedCents: plannedCents(itinerary.slots, travelers),
  }
}

/** The decisions page: the trip, who is on it, the itinerary, and its open slots in order. */
export async function loadTripDecisions(session: Session, tripId: string) {
  const db = getDb()
  const { context, household } = session

  const [trip, members, itinerary] = await Promise.all([
    getTripWithCounts(context, db, tripId),
    listMembers(context, db),
    listItinerary(context, db, tripId),
  ])

  return {
    trip: toTrip(trip),
    timeZone: household.timeZone,
    today: todayInTimeZone(household.timeZone),
    members: members.map(toHouseholdMember),
    itinerary: await itineraryView(itinerary, travelersOn(trip), household.timeZone),
    decisions: decisionsFor(itinerary.slots, household.timeZone),
  }
}

// The travel lists for the API, a page at a time, each in the same order as its page.

export async function loadTripsPage(session: Session, query: PageQuery & Pick<ListTripsOptions, 'phase' | 'status'>) {
  const { context, household } = session
  const today = todayInTimeZone(household.timeZone)
  // Today decides which trips are upcoming and which are past, so a cursor from yesterday starts over.
  const scope = {
    sort: 'trips:starts-on',
    filters: { phase: query.phase, status: query.status, today: query.phase === 'all' ? undefined : today },
  }
  const page = await listTripsPage(context, getDb(), { phase: query.phase, status: query.status, today }, pageRequest(query, scope))
  return { ...pageResponse(page, scope, toTripSummary), today, timeZone: household.timeZone }
}

export async function loadTripIdeasPage(session: Session, query: PageQuery) {
  const scope = { sort: 'trip-ideas:created' }
  const page = await listTripIdeasPage(session.context, getDb(), pageRequest(query, scope))
  return pageResponse(page, scope, toTripIdea)
}

export async function loadPackingPage(session: Session, tripId: string, query: PageQuery) {
  const scope = { sort: 'packing:sort-order', filters: { tripId } }
  const page = await listPackingItemsPage(session.context, getDb(), tripId, pageRequest(query, scope))
  return pageResponse(page, scope, toPackingItem)
}

export async function loadPackingTemplatesPage(session: Session, query: PageQuery) {
  const scope = { sort: 'packing-templates:name' }
  const page = await listPackingTemplatesPage(session.context, getDb(), pageRequest(query, scope))
  return pageResponse(page, scope, toPackingTemplate)
}

/**
 * Planned against actual. The total is travel data, so everyone who can see the trip sees it.
 * The charges behind it are finances data, and come back empty for a role without finances.
 */
export async function loadTripBudget(session: Session, tripId: string) {
  const db = getDb()
  const { context } = session

  const [trip, itinerary, actualCents, transactions] = await Promise.all([
    getTripWithCounts(context, db, tripId),
    listItinerary(context, db, tripId),
    sumTripActualCents(context, db, tripId),
    can(context.role, 'finances.view') ? listTripTransactions(context, db, { tripId, limit: 200 }) : Promise.resolve([]),
  ])

  return {
    tripId: trip.id,
    plannedCents: trip.budgetCents,
    actualCents,
    committedCents: plannedCents(itinerary.slots, travelersOn(trip)),
    transactions: transactions.map(toTripTransaction),
  }
}

/**
 * Travel mode gets the whole trip, not just today: a client that caches this still has
 * tomorrow when there is no signal. `generatedAt` is what a cached copy shows to say how
 * old it is.
 */
export async function loadTravelMode(session: Session, tripId: string): Promise<TravelMode> {
  const db = getDb()
  const { context, household } = session

  const [trip, itinerary, bookings] = await Promise.all([
    getTripWithCounts(context, db, tripId),
    listItinerary(context, db, tripId),
    listTripBookings(context, db, { tripId }),
  ])

  return {
    trip: toTrip(trip),
    timeZone: household.timeZone,
    today: todayInTimeZone(household.timeZone),
    generatedAt: new Date().toISOString(),
    slots: itinerary.slots.map(toItinerarySlot),
    bookings: bookings.map(toBooking),
  }
}
