import { ConflictError, ForbiddenError, NotFoundError } from '@ghar/core/errors'
import {
  arrivalFields,
  ARRIVAL_READS_PER_DAY,
  rideState,
  sortArrivals,
  type ArrivalDirection,
  type ArrivalMode,
  type RideState,
} from '@ghar/core/trip-arrivals'
import { firstName, samePerson, type TripPersonKey } from '@ghar/core/trip-guests'
import { and, count, eq, gt, isNull, sql } from 'drizzle-orm'
import { auditLog, profiles, tripArrivals, trips } from '../schema'
import { recordAudit } from './audit'
import { auditActor, requireParticipant, type Participant } from './trip-participant'
import { canEditFor, findOnRoster, keyColumns, keyOf, loadRoster, requireEditFor } from './trip-roster'
import type { Db, SessionContext } from './types'

// When everyone gets to the trip and leaves, and who's picking them up. The household and its
// guests see the same board. Each person fills in their own; the household fills in for its own
// travellers too. Anyone who can vote can offer someone a ride.

const ARRIVAL_NOT_FOUND = 'That travel was already taken off.'

export interface TripArrivalView {
  id: string
  person: TripPersonKey
  /** First name. Null when they gave none. */
  name: string | null
  host: boolean
  /** The caller's own. */
  you: boolean
  direction: ArrivalDirection
  mode: ArrivalMode
  at: Date
  place: string | null
  number: string | null
  wantsRide: boolean
  ride: RideState
  /** First name of whoever is giving the ride. */
  rideBy: string | null
  rideMine: boolean
  canEdit: boolean
  canOfferRide: boolean
  canCancelRide: boolean
}

export interface TripArrivalPerson {
  person: TripPersonKey
  name: string | null
  host: boolean
  you: boolean
  canEdit: boolean
}

export interface TripArrivalsView {
  /** Earliest first. Only for people still on the trip. */
  arrivals: TripArrivalView[]
  /** Everyone going or thinking about it, in the order of who's going. */
  people: TripArrivalPerson[]
  /** The caller can paste a confirmation to be read: anyone who can fill in someone's travel. */
  canRead: boolean
}

export async function listTripArrivals(ctx: SessionContext, db: Db, tripId: string): Promise<TripArrivalsView> {
  return loadArrivals(db, await requireParticipant(ctx, db, tripId))
}

async function loadArrivals(db: Db, participant: Participant): Promise<TripArrivalsView> {
  const [roster, rows] = await Promise.all([
    loadRoster(db, participant.tripId),
    db
      .select({
        id: tripArrivals.id,
        personId: tripArrivals.personId,
        guestId: tripArrivals.guestId,
        direction: tripArrivals.direction,
        mode: tripArrivals.mode,
        at: tripArrivals.at,
        place: tripArrivals.place,
        number: tripArrivals.number,
        wantsRide: tripArrivals.wantsRide,
        rideUserId: tripArrivals.rideUserId,
        rideName: profiles.fullName,
      })
      .from(tripArrivals)
      .leftJoin(profiles, eq(profiles.id, tripArrivals.rideUserId))
      .where(eq(tripArrivals.tripId, participant.tripId)),
  ])
  const people = roster.map(entry => ({
    person: entry.key,
    name: entry.name,
    host: entry.host,
    you: entry.userId === participant.userId,
    canEdit: canEditFor(participant, entry),
  }))
  const arrivals = rows.flatMap(({ personId, guestId, rideUserId, rideName, ...row }): TripArrivalView[] => {
    const key = keyOf({ personId, guestId })
    // Someone who came off the list, or said they can't go, drops off the board too.
    const who = key === null ? undefined : people.find(person => samePerson(person.person, key))
    if (!who || key === null) return []
    const ride = rideState({ wantsRide: row.wantsRide, rideUserId })
    const rideMine = rideUserId === participant.userId
    return [
      {
        ...row,
        person: key,
        name: who.name,
        host: who.host,
        you: who.you,
        ride,
        rideBy: ride === 'arranged' ? firstName(rideName) : null,
        rideMine,
        canEdit: who.canEdit,
        canOfferRide: ride === 'wanted' && participant.canVote,
        canCancelRide: ride === 'arranged' && (rideMine || participant.canManage),
      },
    ]
  })
  return { arrivals: sortArrivals(arrivals), people, canRead: people.some(person => person.canEdit) }
}

export interface SaveTripArrivalInput {
  tripId: string
  person: TripPersonKey
  direction: ArrivalDirection
  mode: ArrivalMode
  at: Date
  place: string | null
  number: string | null
  wantsRide: boolean
}

/**
 * Sets someone's way in or out, replacing what was there. A ride someone offered stays offered
 * while a ride is still wanted.
 */
export async function saveTripArrival(ctx: SessionContext, db: Db, input: SaveTripArrivalInput): Promise<TripArrivalsView> {
  const participant = await requireParticipant(ctx, db, input.tripId)
  const entry = findOnRoster(await loadRoster(db, input.tripId), input.person)
  requireEditFor(participant, entry)
  const fields = arrivalFields(input)
  const values = { tripId: input.tripId, ...keyColumns(entry.key), ...fields }
  const set = {
    mode: fields.mode,
    at: fields.at,
    place: fields.place,
    number: fields.number,
    wantsRide: fields.wantsRide,
    rideUserId: sql`case when excluded.wants_ride then ${tripArrivals.rideUserId} else null end`,
    updatedAt: sql`now()`,
  }
  const target =
    entry.key.kind === 'traveller'
      ? [tripArrivals.tripId, tripArrivals.personId, tripArrivals.direction]
      : [tripArrivals.tripId, tripArrivals.guestId, tripArrivals.direction]
  await db.insert(tripArrivals).values(values).onConflictDoUpdate({ target, set })
  return loadArrivals(db, participant)
}

async function requireArrival(db: Db, participant: Participant, arrivalId: string) {
  const [row] = await db
    .select({
      personId: tripArrivals.personId,
      guestId: tripArrivals.guestId,
      wantsRide: tripArrivals.wantsRide,
      rideUserId: tripArrivals.rideUserId,
    })
    .from(tripArrivals)
    .where(and(eq(tripArrivals.id, arrivalId), eq(tripArrivals.tripId, participant.tripId)))
    .limit(1)
  const key = row ? keyOf(row) : null
  if (!row || key === null) throw new NotFoundError(ARRIVAL_NOT_FOUND)
  return { ...row, key }
}

export async function deleteTripArrival(
  ctx: SessionContext,
  db: Db,
  input: { tripId: string; arrivalId: string }
): Promise<TripArrivalsView> {
  const participant = await requireParticipant(ctx, db, input.tripId)
  const arrival = await requireArrival(db, participant, input.arrivalId)
  requireEditFor(participant, findOnRoster(await loadRoster(db, input.tripId), arrival.key))
  await db.delete(tripArrivals).where(and(eq(tripArrivals.id, input.arrivalId), eq(tripArrivals.tripId, input.tripId)))
  return loadArrivals(db, participant)
}

/** Offers the caller as someone's ride, or takes the offer back. The household can take back anyone's. */
export async function setArrivalRide(
  ctx: SessionContext,
  db: Db,
  input: { tripId: string; arrivalId: string; offer: boolean }
): Promise<TripArrivalsView> {
  const participant = await requireParticipant(ctx, db, input.tripId)
  const arrival = await requireArrival(db, participant, input.arrivalId)
  findOnRoster(await loadRoster(db, input.tripId), arrival.key)
  const here = and(eq(tripArrivals.id, input.arrivalId), eq(tripArrivals.tripId, input.tripId))

  if (input.offer) {
    if (!participant.canVote) throw new ForbiddenError('Only people helping plan the trip can offer rides.')
    if (!arrival.wantsRide) throw new ConflictError('They don’t need a ride.')
    const taken = await db
      .update(tripArrivals)
      .set({ rideUserId: participant.userId, updatedAt: sql`now()` })
      .where(and(here, eq(tripArrivals.wantsRide, true), isNull(tripArrivals.rideUserId)))
      .returning({ id: tripArrivals.id })
    if (taken.length === 0 && arrival.rideUserId !== participant.userId) throw new ConflictError('Someone already offered them a ride.')
  } else if (arrival.rideUserId !== null) {
    if (arrival.rideUserId !== participant.userId && !participant.canManage) {
      throw new ForbiddenError('Only whoever offered the ride can take it back.')
    }
    await db
      .update(tripArrivals)
      .set({ rideUserId: null, updatedAt: sql`now()` })
      .where(and(here, eq(tripArrivals.rideUserId, arrival.rideUserId)))
  }
  return loadArrivals(db, participant)
}

export const ARRIVAL_READS_USED = `That’s ${String(ARRIVAL_READS_PER_DAY)} confirmations read today. Fill it in by hand, or try again tomorrow.`

/**
 * Before a pasted confirmation goes to be read: checks the caller can fill in someone's travel on
 * this trip and hasn't used the day's reads, and counts this one. Returns what the reader needs
 * to know about the trip.
 */
export async function claimArrivalRead(
  ctx: SessionContext,
  db: Db,
  tripId: string
): Promise<{ timeZone: string; destination: string | null }> {
  const participant = await requireParticipant(ctx, db, tripId)
  const roster = await loadRoster(db, tripId)
  if (!roster.some(entry => canEditFor(participant, entry))) throw new ForbiddenError('You can only fill in your own travel.')
  const [used] = await db
    .select({ n: count() })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.actorUserId, ctx.userId),
        eq(auditLog.action, 'trip_arrival.read'),
        gt(auditLog.createdAt, sql`now() - interval '1 day'`)
      )
    )
  if ((used?.n ?? 0) >= ARRIVAL_READS_PER_DAY) throw new ConflictError(ARRIVAL_READS_USED)
  await recordAudit(auditActor(participant), db, { action: 'trip_arrival.read', entity: 'trip', entityId: tripId })
  const [trip] = await db.select({ destination: trips.destination }).from(trips).where(eq(trips.id, tripId)).limit(1)
  return { timeZone: participant.timeZone, destination: trip?.destination ?? null }
}
