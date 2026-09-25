import type { CalendarDate } from '@ghar/core/dates'
import type { Cents } from '@ghar/core/money'
import { recapLines, recapWindowStart, type RecapFacts } from '@ghar/core/trip-photos'
import { addCalendarDays } from '@ghar/core/dates'
import { and, count, eq, exists, gte, inArray, isNotNull, lte, notExists, sum } from 'drizzle-orm'
import { households, itinerarySlots, tripCosts, tripGuests, tripPhotos, tripRecapEmails, trips, tripTravellers } from '../schema'
import { authorize } from './authorize'
import { openTransferCount } from './trip-ledger'
import { requireParticipant } from './trip-participant'
import { listTripRecipients, type TripUpdateRecipient } from './trip-recipients'
import type { Actor, Db, SessionContext } from './types'

// The look back once a trip is over: how long it was, who came, what got done, the photos, and
// what's left to settle. Shown on the trip, and emailed once to everyone a few days after.

export interface TripRecapView extends RecapFacts {
  lines: string[]
  /** Shared costs on the trip, in the host household's currency. */
  totalCents: Cents
  currency: string
}

/** Null while the trip has no dates. */
export async function getTripRecap(ctx: SessionContext, db: Db, tripId: string): Promise<TripRecapView | null> {
  const participant = await requireParticipant(ctx, db, tripId)
  return loadRecap(db, participant.hostHouseholdId, tripId)
}

async function loadRecap(db: Db, householdId: string, tripId: string): Promise<TripRecapView | null> {
  const [tripRows, travellers, guests, plans, photos, costs, openTransfers] = await Promise.all([
    db
      .select({ startsOn: trips.startsOn, endsOn: trips.endsOn, currency: households.currency })
      .from(trips)
      .innerJoin(households, eq(households.id, trips.householdId))
      .where(and(eq(trips.id, tripId), eq(trips.householdId, householdId)))
      .limit(1),
    db.select({ n: count() }).from(tripTravellers).where(eq(tripTravellers.tripId, tripId)),
    db
      .select({ n: sum(tripGuests.partySize).mapWith(Number) })
      .from(tripGuests)
      .where(and(eq(tripGuests.tripId, tripId), isNotNull(tripGuests.approvedAt), eq(tripGuests.response, 'going'))),
    db
      .select({ n: count() })
      .from(itinerarySlots)
      .where(and(eq(itinerarySlots.tripId, tripId), inArray(itinerarySlots.status, ['decided', 'booked']))),
    db.select({ n: count() }).from(tripPhotos).where(eq(tripPhotos.tripId, tripId)),
    db
      .select({ n: sum(tripCosts.amountCents).mapWith(Number) })
      .from(tripCosts)
      .where(eq(tripCosts.tripId, tripId)),
    openTransferCount(db, tripId),
  ])
  const trip = tripRows[0]
  if (!trip?.startsOn || !trip.endsOn) return null
  const facts: RecapFacts = {
    startsOn: trip.startsOn,
    endsOn: trip.endsOn,
    people: Math.max(1, travellers[0]?.n ?? 0) + (guests[0]?.n ?? 0),
    plans: plans[0]?.n ?? 0,
    photos: photos[0]?.n ?? 0,
    openTransfers,
  }
  return { ...facts, lines: recapLines(facts), totalCents: costs[0]?.n ?? 0, currency: trip.currency }
}

// The recap email ------------------------------------------------------------------------------

/**
 * The household's trips that ended in the recap window, have guests, and haven't had their recap
 * email. A trip with only the household on it has no one to round up.
 */
export async function listTripsDueRecap(actor: Actor, db: Db, today: CalendarDate): Promise<string[]> {
  authorize(actor, 'travel.view')
  const rows = await db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.householdId, actor.householdId),
        gte(trips.endsOn, recapWindowStart(today)),
        lte(trips.endsOn, addCalendarDays(today, -1)),
        exists(
          db
            .select({ id: tripGuests.id })
            .from(tripGuests)
            .where(and(eq(tripGuests.tripId, trips.id), isNotNull(tripGuests.approvedAt), isNotNull(tripGuests.userId)))
        ),
        notExists(db.select({ id: tripRecapEmails.tripId }).from(tripRecapEmails).where(eq(tripRecapEmails.tripId, trips.id)))
      )
    )
  return rows.map(row => row.id)
}

export interface TripRecapEmail {
  trip: { id: string; name: string; householdName: string }
  recap: TripRecapView
  recipients: TripUpdateRecipient[]
}

/**
 * Marks the trip's recap as sent and hands back what to send and to whom. Null when another run
 * got there first or the trip lost its dates. Give it back with releaseTripRecap if nothing went.
 */
export async function claimTripRecap(actor: Actor, db: Db, tripId: string): Promise<TripRecapEmail | null> {
  authorize(actor, 'travel.view')
  const [trip] = await db
    .select({ id: trips.id, name: trips.name, householdName: households.name })
    .from(trips)
    .innerJoin(households, eq(households.id, trips.householdId))
    .where(and(eq(trips.id, tripId), eq(trips.householdId, actor.householdId)))
    .limit(1)
  if (!trip) return null
  const claimed = await db.insert(tripRecapEmails).values({ tripId }).onConflictDoNothing().returning({ tripId: tripRecapEmails.tripId })
  if (claimed.length === 0) return null
  const [recap, recipients] = await Promise.all([
    loadRecap(db, actor.householdId, tripId),
    listTripRecipients(db, actor.householdId, tripId),
  ])
  if (!recap) return null
  return { trip, recap, recipients }
}

export async function releaseTripRecap(actor: Actor, db: Db, tripId: string): Promise<void> {
  authorize(actor, 'travel.view')
  await db
    .delete(tripRecapEmails)
    .where(
      and(
        eq(tripRecapEmails.tripId, tripId),
        inArray(tripRecapEmails.tripId, db.select({ id: trips.id }).from(trips).where(eq(trips.householdId, actor.householdId)))
      )
    )
}
