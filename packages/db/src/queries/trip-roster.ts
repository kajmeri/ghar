import { ForbiddenError, NotFoundError } from '@ghar/core/errors'
import { samePerson, tripRoster, type RosterEntry, type TripPersonKey } from '@ghar/core/trip-guests'
import { asc, eq, sql } from 'drizzle-orm'
import { householdPeople, profiles, tripGuests, tripTravellers } from '../schema'
import type { Participant } from './trip-participant'
import type { Db } from './types'

// Who is on a trip, each under the key their arrival and bed are kept by. Shared by
// trip-arrivals.ts and trip-rooms.ts, and not exported from the package.

export async function loadRoster(db: Db, tripId: string): Promise<RosterEntry[]> {
  const [travellers, guests] = await Promise.all([
    db
      .select({
        personId: householdPeople.id,
        name: sql<string | null>`coalesce(${householdPeople.name}, ${profiles.fullName})`,
        userId: householdPeople.userId,
      })
      .from(tripTravellers)
      .innerJoin(householdPeople, eq(householdPeople.id, tripTravellers.personId))
      .leftJoin(profiles, eq(profiles.id, householdPeople.userId))
      .where(eq(tripTravellers.tripId, tripId))
      // The household's own order: who joined it first. Travellers added together share a
      // createdAt on trip_travellers, so that column can't settle it.
      .orderBy(asc(householdPeople.createdAt), asc(householdPeople.id)),
    db
      .select({
        guestId: tripGuests.id,
        name: profiles.fullName,
        userId: tripGuests.userId,
        response: tripGuests.response,
        partySize: tripGuests.partySize,
        approvedAt: tripGuests.approvedAt,
      })
      .from(tripGuests)
      .leftJoin(profiles, eq(profiles.id, tripGuests.userId))
      .where(eq(tripGuests.tripId, tripId))
      .orderBy(asc(tripGuests.respondedAt), asc(tripGuests.id)),
  ])
  return tripRoster({ travellers, guests })
}

/**
 * Whether the caller can fill in this person's travel: a guest their own, and the household its
 * own travellers, which a traveller with an account can also do for themselves if they can
 * change things on the trip. A viewer who travels only looks, like everywhere else on the trip,
 * and so can't spend the trip's reads of pasted confirmations either.
 */
export function canEditFor(participant: Participant, entry: RosterEntry): boolean {
  if (entry.key.kind === 'guest') return participant.access === 'guest' && entry.key.id === participant.guestId
  return participant.access === 'household' && (participant.canManage || (participant.canVote && entry.userId === participant.userId))
}

export const NOT_ON_ROSTER = "They're not on the trip's list of who's going."

export function findOnRoster(roster: readonly RosterEntry[], key: TripPersonKey): RosterEntry {
  const entry = roster.find(candidate => samePerson(candidate.key, key))
  if (!entry) throw new NotFoundError(NOT_ON_ROSTER)
  return entry
}

export function requireEditFor(participant: Participant, entry: RosterEntry): void {
  if (!canEditFor(participant, entry)) throw new ForbiddenError('You can only fill in your own travel.')
}

/** The person-or-guest columns a row is kept under. */
export function keyColumns(key: TripPersonKey): { personId: string | null; guestId: string | null } {
  return key.kind === 'traveller' ? { personId: key.id, guestId: null } : { personId: null, guestId: key.id }
}

export function keyOf(row: { personId: string | null; guestId: string | null }): TripPersonKey | null {
  if (row.personId !== null) return { kind: 'traveller', id: row.personId }
  if (row.guestId !== null) return { kind: 'guest', id: row.guestId }
  return null
}
