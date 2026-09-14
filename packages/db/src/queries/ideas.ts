import { requirePermission } from '@ghar/core/auth';
import type { CalendarDate } from '@ghar/core/dates';
import { NotFoundError } from '@ghar/core/errors';
import { applyVote, type Vote } from '@ghar/core/ideas';
import { and, eq, sql } from 'drizzle-orm';
import { tripIdeas } from '../schema';
import { recordAudit } from './audit';
import { createTrip, type TripWithCounts } from './trips';
import type { Db, RequestContext } from './types';

// The idea board: places the household might go, voted on, and promoted into trips.

export type TripIdeaRow = typeof tripIdeas.$inferSelect;

const IDEA_NOT_FOUND = 'That idea no longer exists.';

function ideaKey(ctx: RequestContext, ideaId: string) {
  return and(eq(tripIdeas.id, ideaId), eq(tripIdeas.householdId, ctx.householdId));
}

export async function listTripIdeas(ctx: RequestContext, db: Db): Promise<TripIdeaRow[]> {
  requirePermission(ctx, 'travel.view');
  return db
    .select()
    .from(tripIdeas)
    .where(eq(tripIdeas.householdId, ctx.householdId))
    .orderBy(tripIdeas.createdAt);
}

export async function requireTripIdea(
  ctx: RequestContext,
  db: Db,
  ideaId: string,
): Promise<TripIdeaRow> {
  requirePermission(ctx, 'travel.view');
  const [idea] = await db.select().from(tripIdeas).where(ideaKey(ctx, ideaId)).limit(1);
  if (!idea) throw new NotFoundError(IDEA_NOT_FOUND);
  return idea;
}

export async function createTripIdea(
  ctx: RequestContext,
  db: Db,
  input: {
    title: string;
    destination: string | null;
    url: string | null;
    notes: string | null;
    imageUrl: string | null;
  },
): Promise<TripIdeaRow> {
  requirePermission(ctx, 'travel.manage');
  const [idea] = await db
    .insert(tripIdeas)
    .values({ householdId: ctx.householdId, createdByUserId: ctx.userId, ...input })
    .returning();
  if (!idea) throw new Error('The idea was not created');
  return idea;
}

export async function deleteTripIdea(ctx: RequestContext, db: Db, ideaId: string): Promise<void> {
  requirePermission(ctx, 'travel.manage');
  await db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(tripIdeas)
      .where(ideaKey(ctx, ideaId))
      .returning({ id: tripIdeas.id, title: tripIdeas.title });
    if (!deleted) throw new NotFoundError(IDEA_NOT_FOUND);
    await recordAudit(ctx, tx, {
      action: 'trip_idea.deleted',
      entity: 'trip_idea',
      entityId: ideaId,
      metadata: { title: deleted.title },
    });
  });
}

/**
 * One vote per member. The votes map is read and rewritten in a transaction so two people
 * voting at once do not lose each other's vote.
 */
export async function voteOnTripIdea(
  ctx: RequestContext,
  db: Db,
  ideaId: string,
  vote: Vote | null,
): Promise<TripIdeaRow> {
  requirePermission(ctx, 'travel.manage');
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(tripIdeas)
      .where(ideaKey(ctx, ideaId))
      .limit(1)
      .for('update');
    if (!current) throw new NotFoundError(IDEA_NOT_FOUND);

    const [idea] = await tx
      .update(tripIdeas)
      .set({ votes: applyVote(current.votes, ctx.userId, vote), updatedAt: sql`now()` })
      .where(ideaKey(ctx, ideaId))
      .returning();
    if (!idea) throw new NotFoundError(IDEA_NOT_FOUND);
    return idea;
  });
}

/**
 * An idea becomes a trip. The idea is removed once the trip exists: leaving it on the
 * board would have the household voting on something already decided.
 *
 * The new trip starts as `planned` when it has dates and `idea` when it does not, which is
 * the distinction the board is drawing in the first place.
 */
export async function promoteTripIdea(
  ctx: RequestContext,
  db: Db,
  ideaId: string,
  input: { name?: string; startsOn: CalendarDate | null; endsOn: CalendarDate | null },
): Promise<TripWithCounts> {
  requirePermission(ctx, 'travel.manage');
  const idea = await requireTripIdea(ctx, db, ideaId);

  return db.transaction(async (tx) => {
    const trip = await createTrip(ctx, tx, {
      name: input.name ?? idea.title,
      destination: idea.destination,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      status: input.startsOn === null ? 'idea' : 'planned',
      coverImageUrl: idea.imageUrl,
      budgetCents: null,
      notes: idea.notes,
      memberUserIds: [],
    });
    await tx.delete(tripIdeas).where(ideaKey(ctx, ideaId));
    await recordAudit(ctx, tx, {
      action: 'trip_idea.promoted',
      entity: 'trip_idea',
      entityId: ideaId,
      metadata: { tripId: trip.id },
    });
    return trip;
  });
}
