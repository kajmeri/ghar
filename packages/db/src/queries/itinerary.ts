import 'server-only';
import type { RequestContext } from '@casa/contracts';
import type { CalendarDate } from '@casa/core/dates';
import { NotFoundError } from '@casa/core/errors';
import {
  type ItineraryKind,
  type PositionChange,
  itemsOnDay,
  moveWithinDay,
  reorderWithinDay,
  sortOrderForInsert,
} from '@casa/core/itinerary';
import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../index';
import { itineraryItems } from '../schema';
import { requireTrip } from './scope';

export type ItineraryItemRow = typeof itineraryItems.$inferSelect;

export async function listItineraryItems(
  db: Database,
  ctx: RequestContext,
  tripId: string,
): Promise<ItineraryItemRow[]> {
  await requireTrip(db, ctx, tripId);
  return db
    .select()
    .from(itineraryItems)
    .where(eq(itineraryItems.tripId, tripId))
    .orderBy(itineraryItems.day, itineraryItems.sortOrder);
}

export interface CreateItineraryItemInput {
  readonly day: CalendarDate;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly kind: ItineraryKind;
  readonly title: string;
  readonly location: string | null;
  readonly address: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly confirmationCode: string | null;
  readonly costCents: number | null;
  readonly url: string | null;
  readonly notes: string | null;
  readonly bookingId?: string | null;
}

/** Position is worked out here, not asked for: a caller adding an item has no order to give. */
export async function createItineraryItem(
  db: Database,
  ctx: RequestContext,
  tripId: string,
  input: CreateItineraryItemInput,
): Promise<ItineraryItemRow> {
  await requireTrip(db, ctx, tripId);
  const dayItems = await db
    .select()
    .from(itineraryItems)
    .where(and(eq(itineraryItems.tripId, tripId), eq(itineraryItems.day, input.day)));

  const [item] = await db
    .insert(itineraryItems)
    .values({
      tripId,
      ...input,
      bookingId: input.bookingId ?? null,
      sortOrder: sortOrderForInsert(dayItems, input.startsAt),
    })
    .returning();
  if (!item) throw new Error('The itinerary item was not created');
  return item;
}

export type UpdateItineraryItemInput = Partial<Omit<CreateItineraryItemInput, 'bookingId'>>;

export async function updateItineraryItem(
  db: Database,
  ctx: RequestContext,
  tripId: string,
  itemId: string,
  patch: UpdateItineraryItemInput,
): Promise<ItineraryItemRow> {
  await requireTrip(db, ctx, tripId);
  const [item] = await db
    .update(itineraryItems)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(itineraryItems.id, itemId), eq(itineraryItems.tripId, tripId)))
    .returning();
  if (!item) throw new NotFoundError('That itinerary item does not exist');
  return item;
}

export async function deleteItineraryItem(
  db: Database,
  ctx: RequestContext,
  tripId: string,
  itemId: string,
): Promise<void> {
  await requireTrip(db, ctx, tripId);
  const [deleted] = await db
    .delete(itineraryItems)
    .where(and(eq(itineraryItems.id, itemId), eq(itineraryItems.tripId, tripId)))
    .returning({ id: itineraryItems.id });
  if (!deleted) throw new NotFoundError('That itinerary item does not exist');
}

export type ReorderInput =
  | { readonly itemId: string; readonly day: CalendarDate; readonly toIndex: number }
  | { readonly itemId: string; readonly direction: 'up' | 'down' };

/**
 * Both gestures come through here: a drag sends the index it was dropped at, the move
 * buttons send a direction. @casa/core works out the new positions; this writes them.
 *
 * A drop onto a different day moves the item there first, so a drag across days is one
 * transaction rather than a move followed by a reorder that could half-apply.
 */
export async function reorderItinerary(
  db: Database,
  ctx: RequestContext,
  tripId: string,
  input: ReorderInput,
): Promise<ItineraryItemRow[]> {
  await requireTrip(db, ctx, tripId);

  return db.transaction(async (tx) => {
    const all = await tx.select().from(itineraryItems).where(eq(itineraryItems.tripId, tripId));
    const moved = all.find((item) => item.id === input.itemId);
    if (!moved) throw new NotFoundError('That itinerary item does not exist');

    let changes: PositionChange[];
    if ('direction' in input) {
      changes = moveWithinDay(itemsOnDay(all, moved.day), input.itemId, input.direction);
    } else {
      if (input.day !== moved.day) {
        await tx
          .update(itineraryItems)
          .set({ day: input.day, updatedAt: new Date() })
          .where(eq(itineraryItems.id, moved.id));
      }
      const day = [
        ...itemsOnDay(all, input.day).filter((item) => item.id !== moved.id),
        { ...moved, day: input.day },
      ];
      changes = reorderWithinDay(day, input.itemId, input.toIndex);
    }

    for (const change of changes) {
      await tx
        .update(itineraryItems)
        .set({ sortOrder: change.sortOrder, updatedAt: new Date() })
        .where(eq(itineraryItems.id, change.id));
    }

    return tx
      .select()
      .from(itineraryItems)
      .where(eq(itineraryItems.tripId, tripId))
      .orderBy(itineraryItems.day, itineraryItems.sortOrder);
  });
}

/**
 * Writes items generated from bookings. `onConflictDoNothing` on (tripId, bookingId) is
 * what makes generating twice a no-op the second time rather than a pile of duplicates.
 */
export async function insertGeneratedItems(
  db: Database,
  tripId: string,
  drafts: readonly (CreateItineraryItemInput & { bookingId: string })[],
): Promise<ItineraryItemRow[]> {
  if (drafts.length === 0) return [];

  // Positions continue from whatever each day already holds, per day.
  const existing = await db.select().from(itineraryItems).where(eq(itineraryItems.tripId, tripId));
  const nextByDay = new Map<CalendarDate, number>();
  for (const item of existing) {
    nextByDay.set(item.day, Math.max(nextByDay.get(item.day) ?? 0, item.sortOrder));
  }

  const values = drafts.map((draft) => {
    const sortOrder = (nextByDay.get(draft.day) ?? 0) + 1000;
    nextByDay.set(draft.day, sortOrder);
    return { tripId, ...draft, sortOrder };
  });

  return db
    .insert(itineraryItems)
    .values(values)
    .onConflictDoNothing({ target: [itineraryItems.tripId, itineraryItems.bookingId] })
    .returning();
}

export async function deleteItemsForBookings(
  db: Database,
  tripId: string,
  bookingIds: readonly string[],
): Promise<number> {
  if (bookingIds.length === 0) return 0;
  const deleted = await db
    .delete(itineraryItems)
    .where(
      and(eq(itineraryItems.tripId, tripId), inArray(itineraryItems.bookingId, [...bookingIds])),
    )
    .returning({ id: itineraryItems.id });
  return deleted.length;
}
