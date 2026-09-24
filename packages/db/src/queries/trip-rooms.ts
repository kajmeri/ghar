import { ConflictError, NotFoundError } from '@ghar/core/errors'
import { samePerson, type TripPersonKey } from '@ghar/core/trip-guests'
import { MAX_TRIP_ROOMS, roomFill, roomName, roomSleeps, type RoomFill } from '@ghar/core/trip-rooms'
import { and, asc, count, eq } from 'drizzle-orm'
import { tripRoomAssignments, tripRooms, trips } from '../schema'
import { requireManager, requireParticipant, type Participant } from './trip-participant'
import { findOnRoster, keyColumns, keyOf, loadRoster } from './trip-roster'
import type { Db, SessionContext } from './types'

// Who sleeps where. The household sets up the rooms and puts people in them; the household and its
// guests all see the plan. A guest takes as many beds as the party they bring.

const ROOM_NOT_FOUND = 'That room was already taken off.'

export interface TripRoomPerson {
  person: TripPersonKey
  name: string | null
  /** Beds they take: their whole party, for a guest. */
  heads: number
  host: boolean
  you: boolean
}

export interface TripRoomView {
  id: string
  name: string
  sleeps: number
  /** Beds taken. */
  heads: number
  fill: RoomFill
  people: TripRoomPerson[]
}

export interface TripRoomsView {
  /** In the order they were added. */
  rooms: TripRoomView[]
  /** People going who aren't in a room yet. */
  unplaced: TripRoomPerson[]
  canManage: boolean
}

export async function listTripRooms(ctx: SessionContext, db: Db, tripId: string): Promise<TripRoomsView> {
  return loadRooms(db, await requireParticipant(ctx, db, tripId))
}

async function loadRooms(db: Db, participant: Participant): Promise<TripRoomsView> {
  const [roster, rooms, placed] = await Promise.all([
    loadRoster(db, participant.tripId),
    db
      .select({ id: tripRooms.id, name: tripRooms.name, sleeps: tripRooms.sleeps })
      .from(tripRooms)
      .where(eq(tripRooms.tripId, participant.tripId))
      .orderBy(asc(tripRooms.createdAt), asc(tripRooms.id)),
    db
      .select({ roomId: tripRoomAssignments.roomId, personId: tripRoomAssignments.personId, guestId: tripRoomAssignments.guestId })
      .from(tripRoomAssignments)
      .where(eq(tripRoomAssignments.tripId, participant.tripId)),
  ])
  const people = roster.map(entry => ({
    person: entry.key,
    name: entry.name,
    heads: entry.heads,
    host: entry.host,
    you: entry.userId === participant.userId,
  }))
  // Someone who came off the list, or said they can't go, gives their bed back.
  const roomOf = (person: TripRoomPerson) =>
    placed.find(row => {
      const key = keyOf(row)
      return key !== null && samePerson(key, person.person)
    })?.roomId ?? null
  return {
    rooms: rooms.map(room => {
      const inRoom = people.filter(person => roomOf(person) === room.id)
      const heads = inRoom.reduce((sum, person) => sum + person.heads, 0)
      return { ...room, heads, fill: roomFill(room.sleeps, heads), people: inRoom }
    }),
    unplaced: people.filter(person => roomOf(person) === null),
    canManage: participant.canManage,
  }
}

async function requireManagerOf(ctx: SessionContext, db: Db, tripId: string): Promise<Participant> {
  const participant = await requireParticipant(ctx, db, tripId)
  requireManager(participant)
  return participant
}

export async function createTripRoom(
  ctx: SessionContext,
  db: Db,
  input: { tripId: string; name: string; sleeps: number }
): Promise<TripRoomsView> {
  const participant = await requireManagerOf(ctx, db, input.tripId)
  const name = roomName(input.name)
  const sleeps = roomSleeps(input.sleeps)
  await db.transaction(async tx => {
    // One at a time per trip, so two adds can't both slip under the limit.
    await tx.select({ id: trips.id }).from(trips).where(eq(trips.id, input.tripId)).for('update')
    const [rooms] = await tx.select({ n: count() }).from(tripRooms).where(eq(tripRooms.tripId, input.tripId))
    if ((rooms?.n ?? 0) >= MAX_TRIP_ROOMS) throw new ConflictError(`A trip can have up to ${String(MAX_TRIP_ROOMS)} rooms.`)
    await tx.insert(tripRooms).values({ tripId: input.tripId, name, sleeps })
  })
  return loadRooms(db, participant)
}

export async function updateTripRoom(
  ctx: SessionContext,
  db: Db,
  input: { tripId: string; roomId: string; name?: string; sleeps?: number }
): Promise<TripRoomsView> {
  const participant = await requireManagerOf(ctx, db, input.tripId)
  const patch = {
    ...(input.name === undefined ? {} : { name: roomName(input.name) }),
    ...(input.sleeps === undefined ? {} : { sleeps: roomSleeps(input.sleeps) }),
  }
  const here = and(eq(tripRooms.id, input.roomId), eq(tripRooms.tripId, input.tripId))
  const updated =
    Object.keys(patch).length === 0
      ? await db.select({ id: tripRooms.id }).from(tripRooms).where(here)
      : await db.update(tripRooms).set(patch).where(here).returning({ id: tripRooms.id })
  if (updated.length === 0) throw new NotFoundError(ROOM_NOT_FOUND)
  return loadRooms(db, participant)
}

/** Takes the room off; whoever was in it goes back to not having a room. */
export async function deleteTripRoom(ctx: SessionContext, db: Db, input: { tripId: string; roomId: string }): Promise<TripRoomsView> {
  const participant = await requireManagerOf(ctx, db, input.tripId)
  const deleted = await db
    .delete(tripRooms)
    .where(and(eq(tripRooms.id, input.roomId), eq(tripRooms.tripId, input.tripId)))
    .returning({ id: tripRooms.id })
  if (deleted.length === 0) throw new NotFoundError(ROOM_NOT_FOUND)
  return loadRooms(db, participant)
}

/** Puts someone in a room, moving them out of any other, or with no room takes them out. */
export async function placeTripPerson(
  ctx: SessionContext,
  db: Db,
  input: { tripId: string; person: TripPersonKey; roomId: string | null }
): Promise<TripRoomsView> {
  const participant = await requireManagerOf(ctx, db, input.tripId)
  const entry = findOnRoster(await loadRoster(db, input.tripId), input.person)
  const columns = keyColumns(entry.key)
  const mine =
    entry.key.kind === 'traveller' ? eq(tripRoomAssignments.personId, entry.key.id) : eq(tripRoomAssignments.guestId, entry.key.id)

  if (input.roomId === null) {
    await db.delete(tripRoomAssignments).where(and(eq(tripRoomAssignments.tripId, input.tripId), mine))
    return loadRooms(db, participant)
  }
  const [room] = await db
    .select({ id: tripRooms.id })
    .from(tripRooms)
    .where(and(eq(tripRooms.id, input.roomId), eq(tripRooms.tripId, input.tripId)))
    .limit(1)
  if (!room) throw new NotFoundError(ROOM_NOT_FOUND)
  const target =
    entry.key.kind === 'traveller'
      ? [tripRoomAssignments.tripId, tripRoomAssignments.personId]
      : [tripRoomAssignments.tripId, tripRoomAssignments.guestId]
  await db
    .insert(tripRoomAssignments)
    .values({ tripId: input.tripId, roomId: room.id, ...columns })
    .onConflictDoUpdate({ target, set: { roomId: room.id } })
  return loadRooms(db, participant)
}
