import { requirePermission } from '@ghar/core/auth'
import type { TimeZone } from '@ghar/core/dates'
import { NotFoundError } from '@ghar/core/errors'
import { slotDraftFromBooking, type BookingSlotDraft } from '@ghar/core/itinerary'
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { bookings } from '../schema'
import { recordAudit } from './audit'
import { getSlot, listItinerary, type Itinerary, type ItinerarySlotWithOptions } from './itinerary'
import { requireTrip } from './scope'
import { bookingColumns, type BookingRow } from './travel'
import { bookingsOnItinerary, deleteOptionsForBookings, insertBookingSlots } from './trip-items'
import type { Db, RequestContext } from './types'

// Filing bookings under trips. A booking exists before anyone decides which trip it belongs to,
// so `bookings.trip_id` is nullable and linking is its own action. The bookings themselves, and
// their price watch, live in travel.ts.

const BOOKING_NOT_FOUND = 'That booking no longer exists.'

/** Soonest first: a flight by when it leaves, a stay or rental by its first day. */
const bookingStart = sql`coalesce(${bookings.departAt}::date, ${bookings.checkIn})`

export interface ListTripBookingsOptions {
  /** "unlinked" is the pile the travel hub asks you to file. */
  readonly filed?: 'unlinked' | 'linked' | 'all'
  readonly tripId?: string
}

export async function listTripBookings(
  ctx: RequestContext,
  db: Db,
  { filed = 'all', tripId }: ListTripBookingsOptions = {}
): Promise<BookingRow[]> {
  requirePermission(ctx, 'travel.view')
  const filedFilter = filed === 'unlinked' ? isNull(bookings.tripId) : filed === 'linked' ? isNotNull(bookings.tripId) : undefined

  return db
    .select(bookingColumns)
    .from(bookings)
    .where(and(eq(bookings.householdId, ctx.householdId), filedFilter, tripId ? eq(bookings.tripId, tripId) : undefined))
    .orderBy(asc(bookingStart), asc(bookings.createdAt), asc(bookings.id))
}

/**
 * Filing a booking under a trip, and putting it on the itinerary while we are here, as a slot
 * already booked on it. The slot is skipped when the booking is cancelled, or has no date on a trip
 * with none either: there is no day to hang it on, and guessing would be worse than leaving it
 * linked but unlisted.
 *
 * Moving a booking from one trip to another takes its option off the old trip.
 */
export async function linkBookingToTrip(
  ctx: RequestContext,
  db: Db,
  tripId: string,
  bookingId: string,
  options: { timeZone: TimeZone; addToItinerary: boolean }
): Promise<{ booking: BookingRow; slot: ItinerarySlotWithOptions | null }> {
  requirePermission(ctx, 'travel.manage')
  const trip = await requireTrip(ctx, db, tripId)

  const { booking, slotId } = await db.transaction(async tx => {
    const bookingKey = and(eq(bookings.id, bookingId), eq(bookings.householdId, ctx.householdId))
    const [previous] = await tx.select({ tripId: bookings.tripId }).from(bookings).where(bookingKey).limit(1).for('update')
    if (!previous) throw new NotFoundError(BOOKING_NOT_FOUND)
    if (previous.tripId !== null && previous.tripId !== trip.id) {
      await deleteOptionsForBookings(tx, previous.tripId, [bookingId])
    }

    const [updated] = await tx
      .update(bookings)
      .set({ tripId: trip.id, updatedAt: sql`now()` })
      .where(bookingKey)
      .returning(bookingColumns)
    if (!updated) throw new NotFoundError(BOOKING_NOT_FOUND)
    await recordAudit(ctx, tx, {
      action: 'booking.linked_to_trip',
      entity: 'booking',
      entityId: bookingId,
      metadata: { tripId: trip.id },
    })

    if (!options.addToItinerary || updated.status === 'cancelled') {
      return { booking: updated, slotId: null }
    }
    const draft = slotDraftFromBooking(updated, { timeZone: options.timeZone, fallbackDay: trip.startsOn })
    if (!draft) return { booking: updated, slotId: null }

    const [slot] = await insertBookingSlots(tx, trip.id, [draft], ctx.userId)
    return { booking: updated, slotId: slot?.id ?? null }
  })

  return { booking, slot: slotId === null ? null : await getSlot(ctx, db, trip.id, slotId) }
}

/** Taking a booking off a trip. Its option goes with it, and its slot if nothing else was in it. */
export async function unlinkBookingFromTrip(
  ctx: RequestContext,
  db: Db,
  tripId: string,
  bookingId: string
): Promise<{ booking: BookingRow; removedOptionCount: number }> {
  requirePermission(ctx, 'travel.manage')
  await requireTrip(ctx, db, tripId)

  return db.transaction(async tx => {
    const [booking] = await tx
      .update(bookings)
      .set({ tripId: null, updatedAt: sql`now()` })
      .where(and(eq(bookings.id, bookingId), eq(bookings.householdId, ctx.householdId), eq(bookings.tripId, tripId)))
      .returning(bookingColumns)
    if (!booking) throw new NotFoundError('That booking is not on this trip.')

    const removedOptionCount = await deleteOptionsForBookings(tx, tripId, [bookingId])
    await recordAudit(ctx, tx, {
      action: 'booking.unlinked_from_trip',
      entity: 'booking',
      entityId: bookingId,
      metadata: { tripId },
    })
    return { booking, removedOptionCount }
  })
}

/**
 * Fills the itinerary in from the trip's linked bookings.
 *
 * Idempotent twice over: bookings already on a timeline are filtered out here, and the unique
 * index on an option's booking id catches anything that slips past a concurrent run. Bookings with
 * no date on a trip with no dates have nowhere to go, and come back as skipped rather than being
 * guessed at. Cancelled bookings are left off.
 */
export async function generateItineraryFromBookings(
  ctx: RequestContext,
  db: Db,
  tripId: string,
  options: { timeZone: TimeZone; bookingIds?: readonly string[] }
): Promise<{ itinerary: Itinerary; createdCount: number; skippedBookingIds: string[] }> {
  requirePermission(ctx, 'travel.manage')
  const trip = await requireTrip(ctx, db, tripId)
  const wanted = options.bookingIds ? new Set(options.bookingIds) : null

  const { createdCount, skippedBookingIds } = await db.transaction(async tx => {
    const linked = await tx
      .select(bookingColumns)
      .from(bookings)
      .where(and(eq(bookings.householdId, ctx.householdId), eq(bookings.tripId, trip.id)))
      .orderBy(asc(bookingStart), asc(bookings.id))
    const alreadyOnItinerary = await bookingsOnItinerary(
      tx,
      linked.map(booking => booking.id)
    )

    const skipped: string[] = []
    const drafts: BookingSlotDraft[] = []
    for (const booking of linked) {
      if (alreadyOnItinerary.has(booking.id) || booking.status === 'cancelled') continue
      if (wanted && !wanted.has(booking.id)) continue

      const draft = slotDraftFromBooking(booking, { timeZone: options.timeZone, fallbackDay: trip.startsOn })
      if (draft) drafts.push(draft)
      else skipped.push(booking.id)
    }

    const created = await insertBookingSlots(tx, trip.id, drafts, ctx.userId)
    return { createdCount: created.length, skippedBookingIds: skipped }
  })

  return {
    itinerary: await listItinerary(ctx, db, tripId),
    createdCount,
    skippedBookingIds,
  }
}
