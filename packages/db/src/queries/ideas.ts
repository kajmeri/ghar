import 'server-only';
import type { RequestContext } from '@casa/contracts';
import type { CalendarDate } from '@casa/core/dates';
import { NotFoundError } from '@casa/core/errors';
import { applyVote, type Vote } from '@casa/core/ideas';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../index';
import { tripIdeas } from '../schema';
import { createTrip, type TripWithCounts } from './trips';

export type TripIdeaRow = typeof tripIdeas.$inferSelect;

export async function listTripIdeas(db: Database, ctx: RequestContext): Promise<TripIdeaRow[]> {
  return db
    .select()
    .from(tripIdeas)
    .where(eq(tripIdeas.householdId, ctx.householdId))
    .orderBy(tripIdeas.createdAt);
}

export async function requireTripIdea(
  db: Database,
  ctx: RequestContext,
  ideaId: string,
): Promise<TripIdeaRow> {
  const [idea] = await db
    .select()
    .from(tripIdeas)
    .where(and(eq(tripIdeas.id, ideaId), eq(tripIdeas.householdId, ctx.householdId)))
    .limit(1);
  if (!idea) throw new NotFoundError('That idea does not exist');
  return idea;
}

export async function createTripIdea(
  db: Database,
  ctx: RequestContext,
  input: {
    title: string;
    destination: string | null;
    url: string | null;
    notes: string | null;
    imageUrl: string | null;
  },
): Promise<TripIdeaRow> {
  const [idea] = await db
    .insert(tripIdeas)
    .values({ householdId: ctx.householdId, createdByUserId: ctx.userId, ...input })
    .returning();
  if (!idea) throw new Error('The idea was not created');
  return idea;
}

export async function deleteTripIdea(
  db: Database,
  ctx: RequestContext,
  ideaId: string,
): Promise<void> {
  const [deleted] = await db
    .delete(tripIdeas)
    .where(and(eq(tripIdeas.id, ideaId), eq(tripIdeas.householdId, ctx.householdId)))
    .returning({ id: tripIdeas.id });
  if (!deleted) throw new NotFoundError('That idea does not exist');
}

/**
 * One vote per member. The votes map is read and rewritten in a transaction so two people
 * voting at once do not lose each other's vote.
 */
export async function voteOnTripIdea(
  db: Database,
  ctx: RequestContext,
  ideaId: string,
  vote: Vote | null,
): Promise<TripIdeaRow> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(tripIdeas)
      .where(and(eq(tripIdeas.id, ideaId), eq(tripIdeas.householdId, ctx.householdId)))
      .limit(1)
      .for('update');
    if (!current) throw new NotFoundError('That idea does not exist');

    const [idea] = await tx
      .update(tripIdeas)
      .set({ votes: applyVote(current.votes, ctx.userId, vote), updatedAt: new Date() })
      .where(eq(tripIdeas.id, ideaId))
      .returning();
    if (!idea) throw new NotFoundError('That idea does not exist');
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
  db: Database,
  ctx: RequestContext,
  ideaId: string,
  input: { name?: string; startsOn: CalendarDate | null; endsOn: CalendarDate | null },
): Promise<TripWithCounts> {
  const idea = await requireTripIdea(db, ctx, ideaId);
  const trip = await createTrip(db, ctx, {
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
  await deleteTripIdea(db, ctx, ideaId);
  return trip;
}
