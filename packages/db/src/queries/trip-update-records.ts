import type { CalendarDate } from '@ghar/core/dates'
import type { SlotStatus } from '@ghar/core/itinerary'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { itineraryOptions, tripUpdates } from '../schema'
import type { Db } from './types'

// The updates that post themselves, written in the same transaction as what they report. Like
// trip-items.ts, these take a trip the caller has already resolved, and the index leaves them out.
// Each carries only what guests already see on the plan: a slot's name and day, what was chosen,
// the trip's dates and destination. Anything not yet emailed is replaced rather than piled on, so
// changing your mind twice before the daily email sends one line, not three.

interface SlotFacts {
  readonly id: string
  readonly tripId: string
  readonly label: string
  readonly day: CalendarDate
  readonly status: SlotStatus
  readonly chosenOptionId: string | null
}

/** Drops what hasn't gone out yet about these slots: they were reopened, skipped or deleted. */
export async function forgetSlotUpdates(db: Db, slotIds: readonly string[]): Promise<void> {
  if (slotIds.length === 0) return
  await db.delete(tripUpdates).where(and(inArray(tripUpdates.slotId, [...slotIds]), isNull(tripUpdates.emailedAt)))
}

/**
 * After a slot's choice changes: a new decision or booking posts, and anything that took the
 * decision back drops what hadn't gone out. Choosing what was already chosen says nothing.
 */
export async function recordSlotChoice(
  db: Db,
  before: SlotFacts,
  after: { status: SlotStatus; chosenOptionId: string | null },
  authorUserId: string | null
): Promise<void> {
  const kind = after.status === 'decided' || after.status === 'booked' ? after.status : null
  if (kind && after.status === before.status && after.chosenOptionId === before.chosenOptionId) return
  await forgetSlotUpdates(db, [before.id])
  if (!kind || after.chosenOptionId === null) return
  const [option] = await db
    .select({ title: itineraryOptions.title })
    .from(itineraryOptions)
    .where(eq(itineraryOptions.id, after.chosenOptionId))
    .limit(1)
  await db.insert(tripUpdates).values({
    tripId: before.tripId,
    kind,
    authorUserId,
    label: before.label,
    day: before.day,
    detail: option?.title ?? null,
    slotId: before.id,
  })
}

interface TripFacts {
  readonly startsOn: CalendarDate | null
  readonly endsOn: CalendarDate | null
  readonly destination: string | null
}

/** After a trip's dates or destination change. Clearing one posts nothing. */
export async function recordTripChange(
  db: Db,
  tripId: string,
  before: TripFacts,
  after: TripFacts,
  authorUserId: string | null
): Promise<void> {
  if (before.startsOn !== after.startsOn || before.endsOn !== after.endsOn) {
    await db.delete(tripUpdates).where(and(eq(tripUpdates.tripId, tripId), eq(tripUpdates.kind, 'dates'), isNull(tripUpdates.emailedAt)))
    if (after.startsOn !== null) {
      await db.insert(tripUpdates).values({ tripId, kind: 'dates', authorUserId, day: after.startsOn, endsOn: after.endsOn })
    }
  }
  if (before.destination !== after.destination) {
    await db
      .delete(tripUpdates)
      .where(and(eq(tripUpdates.tripId, tripId), eq(tripUpdates.kind, 'destination'), isNull(tripUpdates.emailedAt)))
    if (after.destination !== null) {
      await db.insert(tripUpdates).values({ tripId, kind: 'destination', authorUserId, detail: after.destination })
    }
  }
}
