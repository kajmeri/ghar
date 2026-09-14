import { requirePermission } from '@ghar/core/auth';
import type { CalendarDate } from '@ghar/core/dates';
import { NotFoundError } from '@ghar/core/errors';
import {
  itemsOnDay,
  moveWithinDay,
  reorderWithinDay,
  sortOrderForInsert,
  type ItineraryKind,
  type PositionChange,
} from '@ghar/core/itinerary';
import { and, eq, sql } from 'drizzle-orm';
import { itineraryItems } from '../schema';
import { requireTrip } from './scope';
import type { Db, RequestContext } from './types';

// A trip's day-by-day timeline. Items carry no household id; every function resolves the trip
// first, and every write filters on the trip id as well as the item id.

export type ItineraryItemRow = typeof itineraryItems.$inferSelect;

const ITEM_NOT_FOUND = 'That itinerary item no longer exists.';

export async function listItineraryItems(
  ctx: RequestContext,
  db: Db,
  tripId: string,
): Promise<ItineraryItemRow[]> {
  await requireTrip(ctx, db, tripId);
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
  ctx: RequestContext,
  db: Db,
  tripId: string,
  input: Omit<CreateItineraryItemInput, 'bookingId'>,
): Promise<ItineraryItemRow> {
  requirePermission(ctx, 'travel.manage');
  await requireTrip(ctx, db, tripId);
  const dayItems = await db
    .select()
    .from(itineraryItems)
    .where(and(eq(itineraryItems.tripId, tripId), eq(itineraryItems.day, input.day)));

  const [item] = await db
    .insert(itineraryItems)
    .values({
      tripId,
      ...input,
      sortOrder: sortOrderForInsert(dayItems, input.startsAt),
    })
    .returning();
  if (!item) throw new Error('The itinerary item was not created');
  return item;
}

export type UpdateItineraryItemInput = Partial<Omit<CreateItineraryItemInput, 'bookingId'>>;

export async function updateItineraryItem(
  ctx: RequestContext,
  db: Db,
  tripId: string,
  itemId: string,
  patch: UpdateItineraryItemInput,
): Promise<ItineraryItemRow> {
  requirePermission(ctx, 'travel.manage');
  await requireTrip(ctx, db, tripId);
  const [item] = await db
    .update(itineraryItems)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(and(eq(itineraryItems.id, itemId), eq(itineraryItems.tripId, tripId)))
    .returning();
  if (!item) throw new NotFoundError(ITEM_NOT_FOUND);
  return item;
}

export async function deleteItineraryItem(
  ctx: RequestContext,
  db: Db,
  tripId: string,
  itemId: string,
): Promise<void> {
  requirePermission(ctx, 'travel.manage');
  await requireTrip(ctx, db, tripId);
  const [deleted] = await db
    .delete(itineraryItems)
    .where(and(eq(itineraryItems.id, itemId), eq(itineraryItems.tripId, tripId)))
    .returning({ id: itineraryItems.id });
  if (!deleted) throw new NotFoundError(ITEM_NOT_FOUND);
}

export type ReorderInput =
  | { readonly itemId: string; readonly day: CalendarDate; readonly toIndex: number }
  | { readonly itemId: string; readonly direction: 'up' | 'down' };

/**
 * Both gestures come through here: a drag sends the index it was dropped at, the move
 * buttons send a direction. @ghar/core works out the new positions; this writes them.
 *
 * A drop onto a different day moves the item there first, so a drag across days is one
 * transaction rather than a move followed by a reorder that could half-apply.
 */
export async function reorderItinerary(
  ctx: RequestContext,
  db: Db,
  tripId: string,
  input: ReorderInput,
): Promise<ItineraryItemRow[]> {
  requirePermission(ctx, 'travel.manage');
  await requireTrip(ctx, db, tripId);

  return db.transaction(async (tx) => {
    const all = await tx.select().from(itineraryItems).where(eq(itineraryItems.tripId, tripId));
    const moved = all.find((item) => item.id === input.itemId);
    if (!moved) throw new NotFoundError(ITEM_NOT_FOUND);

    let changes: PositionChange[];
    if ('direction' in input) {
      changes = moveWithinDay(itemsOnDay(all, moved.day), input.itemId, input.direction);
    } else {
      if (input.day !== moved.day) {
        await tx
          .update(itineraryItems)
          .set({ day: input.day, updatedAt: sql`now()` })
          .where(and(eq(itineraryItems.id, moved.id), eq(itineraryItems.tripId, tripId)));
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
        .set({ sortOrder: change.sortOrder, updatedAt: sql`now()` })
        .where(and(eq(itineraryItems.id, change.id), eq(itineraryItems.tripId, tripId)));
    }

    return tx
      .select()
      .from(itineraryItems)
      .where(eq(itineraryItems.tripId, tripId))
      .orderBy(itineraryItems.day, itineraryItems.sortOrder);
  });
}
