import { requirePermission } from '@ghar/core/auth'
import type { CalendarDate } from '@ghar/core/dates'
import type { TripStatus } from '@ghar/core/trips'
import { and, count, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { bookings, itinerarySlots, packingItems, tripMembers, trips } from '../schema'
import { recordAudit } from './audit'
import { requireHouseholdMembers, requireTrip, type TripRow } from './scope'
import type { Db, RequestContext } from './types'

// Trips: the dated container bookings, the itinerary, packing and tagged charges hang off.

/** A trip with the counts its card shows, so a list does not cost one query per trip. */
export interface TripWithCounts extends TripRow {
  readonly memberUserIds: string[]
  readonly slotCount: number
  /** Slots still open: being debated, or waiting for a first option. */
  readonly openDecisionCount: number
  readonly bookingCount: number
  readonly packedCount: number
  readonly packingItemCount: number
}

export interface ListTripsOptions {
  /** "upcoming" is everything that has not finished, undated ideas included. */
  readonly phase?: 'upcoming' | 'past' | 'all'
  readonly status?: TripStatus
  /** Today in the household's zone. The caller owns the clock; this layer does not. */
  readonly today: CalendarDate
}

export async function listTrips(
  ctx: RequestContext,
  db: Db,
  { phase = 'all', status, today }: ListTripsOptions
): Promise<TripWithCounts[]> {
  requirePermission(ctx, 'travel.view')
  const phaseFilter =
    phase === 'past' ? lt(trips.endsOn, today) : phase === 'upcoming' ? or(isNull(trips.endsOn), gte(trips.endsOn, today)) : undefined

  const rows = await db
    .select()
    .from(trips)
    .where(and(eq(trips.householdId, ctx.householdId), phaseFilter, status ? eq(trips.status, status) : undefined))
    .orderBy(sql`${trips.startsOn} asc nulls last`, trips.name)

  return withCounts(db, rows)
}

export async function getTripWithCounts(ctx: RequestContext, db: Db, tripId: string): Promise<TripWithCounts> {
  const trip = await requireTrip(ctx, db, tripId)
  const [withCount] = await withCounts(db, [trip])
  if (!withCount) throw new Error('unreachable: a trip was dropped while counting')
  return withCount
}

export async function countPastTrips(ctx: RequestContext, db: Db, today: CalendarDate): Promise<number> {
  requirePermission(ctx, 'travel.view')
  const [row] = await db
    .select({ value: count() })
    .from(trips)
    .where(and(eq(trips.householdId, ctx.householdId), lt(trips.endsOn, today)))
  return row?.value ?? 0
}

export interface CreateTripInput {
  readonly name: string
  readonly destination: string | null
  readonly startsOn: CalendarDate | null
  readonly endsOn: CalendarDate | null
  readonly status: TripStatus
  readonly coverImageUrl: string | null
  readonly budgetCents: number | null
  readonly notes: string | null
  readonly memberUserIds: readonly string[]
}

/** Whoever creates a trip is on it; nobody plans a trip they are not going on by accident. */
export async function createTrip(ctx: RequestContext, db: Db, input: CreateTripInput): Promise<TripWithCounts> {
  requirePermission(ctx, 'travel.manage')
  const userIds = [...new Set([ctx.userId, ...input.memberUserIds])]
  await requireHouseholdMembers(ctx, db, userIds)

  return db.transaction(async tx => {
    const [trip] = await tx
      .insert(trips)
      .values({
        householdId: ctx.householdId,
        name: input.name,
        destination: input.destination,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        status: input.status,
        coverImageUrl: input.coverImageUrl,
        budgetCents: input.budgetCents,
        notes: input.notes,
      })
      .returning()
    if (!trip) throw new Error('The trip was not created')

    await tx.insert(tripMembers).values(userIds.map(userId => ({ tripId: trip.id, userId })))
    await recordAudit(ctx, tx, { action: 'trip.created', entity: 'trip', entityId: trip.id })

    return { ...trip, ...emptyCounts, memberUserIds: userIds }
  })
}

export type UpdateTripInput = Partial<Omit<CreateTripInput, 'memberUserIds'>> & {
  readonly memberUserIds?: readonly string[]
}

export async function updateTrip(ctx: RequestContext, db: Db, tripId: string, patch: UpdateTripInput): Promise<TripWithCounts> {
  requirePermission(ctx, 'travel.manage')
  await requireTrip(ctx, db, tripId)
  const { memberUserIds, ...columns } = patch
  if (memberUserIds) await requireHouseholdMembers(ctx, db, memberUserIds)

  await db.transaction(async tx => {
    if (Object.keys(columns).length > 0) {
      await tx
        .update(trips)
        .set({ ...columns, updatedAt: sql`now()` })
        .where(and(eq(trips.id, tripId), eq(trips.householdId, ctx.householdId)))
    }
    if (memberUserIds) {
      // Replace the roster wholesale: a PATCH that sends members is stating who is going.
      await tx.delete(tripMembers).where(eq(tripMembers.tripId, tripId))
      const userIds = [...new Set(memberUserIds)]
      if (userIds.length > 0) {
        await tx.insert(tripMembers).values(userIds.map(userId => ({ tripId, userId })))
      }
    }
    await recordAudit(ctx, tx, {
      action: 'trip.updated',
      entity: 'trip',
      entityId: tripId,
      metadata: { fields: Object.keys(patch) },
    })
  })

  return getTripWithCounts(ctx, db, tripId)
}

/**
 * Deleting a trip takes its itinerary and packing with it, and releases what it organized:
 * bookings and tagged transactions lose their trip but survive, because they are records
 * of things that happened.
 */
export async function deleteTrip(ctx: RequestContext, db: Db, tripId: string): Promise<void> {
  requirePermission(ctx, 'travel.manage')
  const trip = await requireTrip(ctx, db, tripId)
  await db.transaction(async tx => {
    await tx.delete(trips).where(and(eq(trips.id, tripId), eq(trips.householdId, ctx.householdId)))
    await recordAudit(ctx, tx, {
      action: 'trip.deleted',
      entity: 'trip',
      entityId: tripId,
      metadata: { name: trip.name },
    })
  })
}

const emptyCounts = {
  slotCount: 0,
  openDecisionCount: 0,
  bookingCount: 0,
  packedCount: 0,
  packingItemCount: 0,
} as const

/** Callers have already scoped `rows` to the household. */
async function withCounts(db: Db, rows: TripRow[]): Promise<TripWithCounts[]> {
  if (rows.length === 0) return []
  const tripIds = rows.map(trip => trip.id)

  const [members, itineraryCounts, bookingCounts, packingCounts] = await Promise.all([
    db.select({ tripId: tripMembers.tripId, userId: tripMembers.userId }).from(tripMembers).where(inArray(tripMembers.tripId, tripIds)),
    db
      .select({
        tripId: itinerarySlots.tripId,
        value: count(),
        open: sql<number>`count(*) filter (where ${itinerarySlots.status} = 'open')`.mapWith(Number),
      })
      .from(itinerarySlots)
      .where(inArray(itinerarySlots.tripId, tripIds))
      .groupBy(itinerarySlots.tripId),
    db.select({ tripId: bookings.tripId, value: count() }).from(bookings).where(inArray(bookings.tripId, tripIds)).groupBy(bookings.tripId),
    db
      .select({
        tripId: packingItems.tripId,
        value: count(),
        packed: sql<number>`count(*) filter (where ${packingItems.isPacked})`.mapWith(Number),
      })
      .from(packingItems)
      .where(inArray(packingItems.tripId, tripIds))
      .groupBy(packingItems.tripId),
  ])

  const memberIds = new Map<string, string[]>()
  for (const { tripId, userId } of members) {
    const existing = memberIds.get(tripId)
    if (existing) existing.push(userId)
    else memberIds.set(tripId, [userId])
  }
  const itineraryByTrip = new Map(itineraryCounts.map(row => [row.tripId, row]))
  const bookingsByTrip = new Map(bookingCounts.flatMap(row => (row.tripId === null ? [] : [[row.tripId, row.value] as const])))
  const packingByTrip = new Map(packingCounts.map(row => [row.tripId, row]))

  return rows.map(trip => ({
    ...trip,
    memberUserIds: memberIds.get(trip.id) ?? [],
    slotCount: itineraryByTrip.get(trip.id)?.value ?? 0,
    openDecisionCount: itineraryByTrip.get(trip.id)?.open ?? 0,
    bookingCount: bookingsByTrip.get(trip.id) ?? 0,
    packedCount: packingByTrip.get(trip.id)?.packed ?? 0,
    packingItemCount: packingByTrip.get(trip.id)?.value ?? 0,
  }))
}
