import { requirePermission } from '@ghar/core/auth'
import type { CalendarDate } from '@ghar/core/dates'
import type { TripStatus } from '@ghar/core/trips'
import { and, count, eq, getTableColumns, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { bookings, itinerarySlots, packingItems, trips, tripTravellers } from '../schema'
import { recordAudit } from './audit'
import { keysetAfter, keysetOrder, pageKeys, toPage, type Keyset, type Page, type PageRequest } from './pagination'
import { requireHouseholdPeople, requireOwnPerson } from './people'
import { requireTrip, type TripRow } from './scope'
import { recordTripChange } from './trip-update-records'
import type { Db, RequestContext } from './types'

// Trips: the dated container bookings, the itinerary, packing and tagged charges hang off.

/** A trip with the counts its card shows, so a list does not cost one query per trip. */
export interface TripWithCounts extends TripRow {
  /** Household people going, by person id. */
  readonly travellerIds: string[]
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
  const rows = await db
    .select()
    .from(trips)
    .where(tripFilter(ctx, { phase, status, today }))
    .orderBy(sql`${trips.startsOn} asc nulls last`, trips.name)

  return withCounts(db, rows)
}

function tripFilter(ctx: RequestContext, { phase = 'all', status, today }: ListTripsOptions) {
  const phaseFilter =
    phase === 'past' ? lt(trips.endsOn, today) : phase === 'upcoming' ? or(isNull(trips.endsOn), gte(trips.endsOn, today)) : undefined
  return and(eq(trips.householdId, ctx.householdId), phaseFilter, status ? eq(trips.status, status) : undefined)
}

const tripOrder: Keyset = {
  keys: [
    { expr: trips.startsOn, kind: 'date', nullable: true },
    { expr: trips.name, kind: 'text' },
  ],
  id: trips.id,
}

/** One page of listTrips, in the same order with the id breaking ties. `phase` defaults to all here too. */
export async function listTripsPage(ctx: RequestContext, db: Db, options: ListTripsOptions, page: PageRequest): Promise<Page<TripWithCounts>> {
  requirePermission(ctx, 'travel.view')
  const fetched = await db
    .select({ ...getTableColumns(trips), pageKeys: pageKeys(tripOrder) })
    .from(trips)
    .where(and(tripFilter(ctx, options), keysetAfter(tripOrder, page.after)))
    .orderBy(...keysetOrder(tripOrder))
    .limit(page.limit + 1)
  const { rows, ...position } = toPage(fetched, page.limit)
  return { ...position, rows: await withCounts(db, rows) }
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
  readonly international?: boolean
  /** People going besides whoever creates it, who always is. */
  readonly travellerIds: readonly string[]
}

/** Whoever creates a trip is on it; nobody plans a trip they are not going on by accident. */
export async function createTrip(ctx: RequestContext, db: Db, input: CreateTripInput): Promise<TripWithCounts> {
  requirePermission(ctx, 'travel.manage')
  const travellerIds = [...new Set([await requireOwnPerson(ctx, db), ...input.travellerIds])]
  await requireHouseholdPeople(ctx, db, travellerIds)

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
        international: input.international ?? false,
        notes: input.notes,
      })
      .returning()
    if (!trip) throw new Error('The trip was not created')

    await tx.insert(tripTravellers).values(travellerIds.map(personId => ({ tripId: trip.id, personId })))
    await recordAudit(ctx, tx, { action: 'trip.created', entity: 'trip', entityId: trip.id })

    return { ...trip, ...emptyCounts, travellerIds }
  })
}

export type UpdateTripInput = Partial<Omit<CreateTripInput, 'travellerIds'>> & {
  readonly travellerIds?: readonly string[]
}

export async function updateTrip(ctx: RequestContext, db: Db, tripId: string, patch: UpdateTripInput): Promise<TripWithCounts> {
  requirePermission(ctx, 'travel.manage')
  const before = await requireTrip(ctx, db, tripId)
  const { travellerIds, ...columns } = patch
  if (travellerIds) await requireHouseholdPeople(ctx, db, travellerIds)

  await db.transaction(async tx => {
    if (Object.keys(columns).length > 0) {
      const [after] = await tx
        .update(trips)
        .set({ ...columns, updatedAt: sql`now()` })
        .where(and(eq(trips.id, tripId), eq(trips.householdId, ctx.householdId)))
        .returning({ startsOn: trips.startsOn, endsOn: trips.endsOn, destination: trips.destination })
      if (after) await recordTripChange(tx, tripId, before, after, ctx.userId)
    }
    if (travellerIds) {
      // Replace the roster wholesale: a PATCH that sends travellers is stating who is going.
      await tx.delete(tripTravellers).where(eq(tripTravellers.tripId, tripId))
      const personIds = [...new Set(travellerIds)]
      if (personIds.length > 0) {
        await tx.insert(tripTravellers).values(personIds.map(personId => ({ tripId, personId })))
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

  const [travellers, itineraryCounts, bookingCounts, packingCounts] = await Promise.all([
    db
      .select({ tripId: tripTravellers.tripId, personId: tripTravellers.personId })
      .from(tripTravellers)
      .where(inArray(tripTravellers.tripId, tripIds))
      .orderBy(tripTravellers.createdAt, tripTravellers.personId),
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

  const travellerIds = new Map<string, string[]>()
  for (const { tripId, personId } of travellers) {
    const existing = travellerIds.get(tripId)
    if (existing) existing.push(personId)
    else travellerIds.set(tripId, [personId])
  }
  const itineraryByTrip = new Map(itineraryCounts.map(row => [row.tripId, row]))
  const bookingsByTrip = new Map(bookingCounts.flatMap(row => (row.tripId === null ? [] : [[row.tripId, row.value] as const])))
  const packingByTrip = new Map(packingCounts.map(row => [row.tripId, row]))

  return rows.map(trip => ({
    ...trip,
    travellerIds: travellerIds.get(trip.id) ?? [],
    slotCount: itineraryByTrip.get(trip.id)?.value ?? 0,
    openDecisionCount: itineraryByTrip.get(trip.id)?.open ?? 0,
    bookingCount: bookingsByTrip.get(trip.id) ?? 0,
    packedCount: packingByTrip.get(trip.id)?.packed ?? 0,
    packingItemCount: packingByTrip.get(trip.id)?.value ?? 0,
  }))
}
