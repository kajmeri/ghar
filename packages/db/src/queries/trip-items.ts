import { planReopen, sortOrderForInsert, type BookingSlotDraft } from '@ghar/core/itinerary'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { itineraryOptions, itinerarySlots } from '../schema'
import type { ItinerarySlotRow } from './itinerary'
import { forgetSlotUpdates, recordSlotChoice } from './trip-update-records'
import type { Db } from './types'

// Itinerary writes for a trip the caller has already resolved with requireTrip, which is why they
// take no context. The index does not export this file, so nothing outside queries/ can reach them.
// Callers run them inside their own transaction.

/** Booking ids that already have an option on some timeline. A booking is on one, once. */
export async function bookingsOnItinerary(db: Db, bookingIds: readonly string[]): Promise<Set<string>> {
  if (bookingIds.length === 0) return new Set()
  const rows = await db
    .select({ bookingId: itineraryOptions.bookingId })
    .from(itineraryOptions)
    .where(and(isNotNull(itineraryOptions.bookingId), inArray(itineraryOptions.bookingId, [...bookingIds])))
  return new Set(rows.flatMap(row => (row.bookingId === null ? [] : [row.bookingId])))
}

/**
 * Writes a slot per booking, already booked on its one option. Bookings already on a timeline are
 * skipped, and the unique index on the option's booking id catches one that slips past a
 * concurrent run: its slot is removed again rather than left empty.
 */
export async function insertBookingSlots(
  db: Db,
  tripId: string,
  drafts: readonly BookingSlotDraft[],
  actorUserId: string
): Promise<ItinerarySlotRow[]> {
  const already = await bookingsOnItinerary(
    db,
    drafts.map(draft => draft.bookingId)
  )
  const created: ItinerarySlotRow[] = []

  for (const draft of drafts) {
    if (already.has(draft.bookingId)) continue
    const cell = await db
      .select({
        id: itinerarySlots.id,
        day: itinerarySlots.day,
        band: itinerarySlots.band,
        startsAt: itinerarySlots.startsAt,
        sortOrder: itinerarySlots.sortOrder,
      })
      .from(itinerarySlots)
      .where(and(eq(itinerarySlots.tripId, tripId), eq(itinerarySlots.day, draft.day), eq(itinerarySlots.band, draft.band)))

    const [slot] = await db
      .insert(itinerarySlots)
      .values({
        tripId,
        day: draft.day,
        band: draft.band,
        kind: draft.kind,
        label: draft.label,
        startsAt: draft.startsAt,
        status: 'open',
        sortOrder: sortOrderForInsert(cell, draft.startsAt),
      })
      .returning()
    if (!slot) throw new Error('The slot was not created')

    const [option] = await db
      .insert(itineraryOptions)
      .values({ slotId: slot.id, ...draft.option, source: 'booking', bookingId: draft.bookingId, status: 'chosen', sortOrder: 1000 })
      .onConflictDoNothing({ target: itineraryOptions.bookingId })
      .returning({ id: itineraryOptions.id })
    if (!option) {
      await db.delete(itinerarySlots).where(eq(itinerarySlots.id, slot.id))
      continue
    }

    const [booked] = await db
      .update(itinerarySlots)
      .set({ status: 'booked', chosenOptionId: option.id })
      .where(eq(itinerarySlots.id, slot.id))
      .returning()
    if (!booked) continue
    created.push(booked)
    await recordSlotChoice(db, slot, booked, actorUserId)
  }
  return created
}

/**
 * Takes bookings' options off a trip's timeline. A slot that held only that option goes with it;
 * a slot that had other options stays, reopened if the booking was the choice.
 */
export async function deleteOptionsForBookings(db: Db, tripId: string, bookingIds: readonly string[]): Promise<number> {
  if (bookingIds.length === 0) return 0
  const doomed = await db
    .select({ id: itineraryOptions.id, slotId: itineraryOptions.slotId })
    .from(itineraryOptions)
    .innerJoin(itinerarySlots, eq(itinerarySlots.id, itineraryOptions.slotId))
    .where(and(eq(itinerarySlots.tripId, tripId), inArray(itineraryOptions.bookingId, [...bookingIds])))

  for (const { id, slotId } of doomed) {
    const [slot] = await db.select().from(itinerarySlots).where(eq(itinerarySlots.id, slotId)).limit(1).for('update')
    if (!slot) continue
    const options = await db.select().from(itineraryOptions).where(eq(itineraryOptions.slotId, slotId))

    if (options.every(option => option.id === id)) {
      await forgetSlotUpdates(db, [slotId])
      await db.delete(itinerarySlots).where(eq(itinerarySlots.id, slotId))
      continue
    }
    if (slot.chosenOptionId === id) {
      const plan = planReopen(options)
      for (const change of plan.options) {
        await db.update(itineraryOptions).set({ status: change.status }).where(eq(itineraryOptions.id, change.id))
      }
      await db.update(itinerarySlots).set({ status: plan.slot.status, chosenOptionId: null }).where(eq(itinerarySlots.id, slotId))
      await forgetSlotUpdates(db, [slotId])
    }
    await db.delete(itineraryOptions).where(eq(itineraryOptions.id, id))
  }
  return doomed.length
}
