import type { CalendarDate } from '@ghar/core/dates'
import { SORT_ORDER_STEP } from '@ghar/core/itinerary'
import { and, eq, inArray } from 'drizzle-orm'
import { itineraryItems } from '../schema'
import type { CreateItineraryItemInput, ItineraryItemRow } from './itinerary'
import type { Db } from './types'

// Itinerary writes for a trip the caller has already resolved with requireTrip, which is why they
// take no context. The index does not export this file, so nothing outside queries/ can reach them.

/**
 * Writes items generated from bookings. `onConflictDoNothing` on (tripId, bookingId) is
 * what makes generating twice a no-op the second time rather than a pile of duplicates.
 */
export async function insertGeneratedItems(
  db: Db,
  tripId: string,
  drafts: readonly (CreateItineraryItemInput & { bookingId: string })[]
): Promise<ItineraryItemRow[]> {
  if (drafts.length === 0) return []

  // Positions continue from whatever each day already holds, per day.
  const existing = await db.select().from(itineraryItems).where(eq(itineraryItems.tripId, tripId))
  const nextByDay = new Map<CalendarDate, number>()
  for (const item of existing) {
    nextByDay.set(item.day, Math.max(nextByDay.get(item.day) ?? 0, item.sortOrder))
  }

  const values = drafts.map(draft => {
    const sortOrder = (nextByDay.get(draft.day) ?? 0) + SORT_ORDER_STEP
    nextByDay.set(draft.day, sortOrder)
    return { tripId, ...draft, sortOrder }
  })

  return db
    .insert(itineraryItems)
    .values(values)
    .onConflictDoNothing({ target: [itineraryItems.tripId, itineraryItems.bookingId] })
    .returning()
}

export async function deleteItemsForBookings(db: Db, tripId: string, bookingIds: readonly string[]): Promise<number> {
  if (bookingIds.length === 0) return 0
  const deleted = await db
    .delete(itineraryItems)
    .where(and(eq(itineraryItems.tripId, tripId), inArray(itineraryItems.bookingId, [...bookingIds])))
    .returning({ id: itineraryItems.id })
  return deleted.length
}
