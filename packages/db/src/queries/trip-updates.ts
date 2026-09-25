import type { CalendarDate } from '@ghar/core/dates'
import { ForbiddenError, NotFoundError } from '@ghar/core/errors'
import { firstName } from '@ghar/core/trip-guests'
import { tripPostBody, TRIP_UPDATES_PAGE_SIZE, type TripUpdateKind } from '@ghar/core/trip-updates'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { households, profiles, trips, tripUpdateMutes, tripUpdates } from '../schema'
import { authorize } from './authorize'
import { requireManager, requireParticipant, type Participant } from './trip-participant'
import { listTripRecipients, type TripUpdateRecipient } from './trip-recipients'
import type { Actor, Db, SessionContext } from './types'

export type { TripUpdateRecipient } from './trip-recipients'

// What's new on a trip, for the household and its guests alike. Posts are written by anyone who
// can vote; the rest post themselves from trip-update-records.ts. Everything goes out by email
// once, in the daily job, unless the household sent a post to everyone straight away. Anyone on
// the trip can turn the email off for themselves.

const UPDATE_NOT_FOUND = 'That update was already removed.'

export interface TripUpdateView {
  id: string
  kind: TripUpdateKind
  /** The author's first name. Null once their account is gone, or when they never gave a name. */
  author: string | null
  mine: boolean
  canDelete: boolean
  body: string | null
  label: string | null
  day: CalendarDate | null
  endsOn: CalendarDate | null
  detail: string | null
  createdAt: Date
}

export interface TripUpdatesView {
  /** Newest first, the latest TRIP_UPDATES_PAGE_SIZE. */
  updates: TripUpdateView[]
  canPost: boolean
  /** Whether a post can go to everyone by email now, rather than in the daily email. */
  canEmail: boolean
  /** Whether the caller turned off email for this trip. */
  muted: boolean
}

const updateColumns = {
  id: tripUpdates.id,
  kind: tripUpdates.kind,
  authorUserId: tripUpdates.authorUserId,
  authorName: profiles.fullName,
  body: tripUpdates.body,
  label: tripUpdates.label,
  day: tripUpdates.day,
  endsOn: tripUpdates.endsOn,
  detail: tripUpdates.detail,
  createdAt: tripUpdates.createdAt,
}

export async function listTripUpdates(ctx: SessionContext, db: Db, tripId: string): Promise<TripUpdatesView> {
  return loadUpdates(db, await requireParticipant(ctx, db, tripId))
}

async function loadUpdates(db: Db, participant: Participant): Promise<TripUpdatesView> {
  const [rows, mute] = await Promise.all([
    db
      .select(updateColumns)
      .from(tripUpdates)
      .leftJoin(profiles, eq(profiles.id, tripUpdates.authorUserId))
      .where(eq(tripUpdates.tripId, participant.tripId))
      .orderBy(desc(tripUpdates.createdAt), desc(tripUpdates.id))
      .limit(TRIP_UPDATES_PAGE_SIZE),
    db
      .select({ userId: tripUpdateMutes.userId })
      .from(tripUpdateMutes)
      .where(and(eq(tripUpdateMutes.tripId, participant.tripId), eq(tripUpdateMutes.userId, participant.userId)))
      .limit(1),
  ])
  return {
    updates: rows.map(({ authorUserId, authorName, ...row }) => {
      const mine = authorUserId === participant.userId
      return {
        ...row,
        author: firstName(authorName),
        mine,
        canDelete: participant.canManage || (row.kind === 'post' && mine && participant.canVote),
      }
    }),
    canPost: participant.canVote,
    canEmail: participant.canManage,
    muted: mute.length > 0,
  }
}

/** A post or a day's worth of updates, ready to email, and who to email them to. */
export interface TripUpdateBatch {
  trip: { id: string; name: string; householdName: string }
  updates: (Omit<TripUpdateView, 'mine' | 'canDelete'> & { authorUserId: string | null })[]
  recipients: TripUpdateRecipient[]
}

/**
 * Posts to the trip. With `emailNow`, only for the household, the post is marked sent as it's
 * written and comes back with everyone to send it to; the caller sends it, and gives it back with
 * releaseTripPostEmail if nothing went, so the daily email picks it up instead.
 */
export async function postTripUpdate(
  ctx: SessionContext,
  db: Db,
  input: { tripId: string; body: string; emailNow: boolean }
): Promise<{ view: TripUpdatesView; email: TripUpdateBatch | null }> {
  const participant = await requireParticipant(ctx, db, input.tripId)
  if (!participant.canVote) throw new ForbiddenError('You can read updates but not post them.')
  if (input.emailNow) requireManager(participant)
  const body = tripPostBody(input.body)
  const [row] = await db
    .insert(tripUpdates)
    .values({
      tripId: input.tripId,
      kind: 'post',
      authorUserId: ctx.userId,
      body,
      emailedAt: input.emailNow ? sql`now()` : null,
    })
    .returning({ id: tripUpdates.id })
  if (!row) throw new Error('Update insert returned no row')
  const view = await loadUpdates(db, participant)
  if (!input.emailNow) return { view, email: null }
  return { view, email: await loadBatch(db, participant.hostHouseholdId, input.tripId, [row.id]) }
}

/** Gives a post back to the daily email, when sending it straight away failed for everyone. */
export async function releaseTripPostEmail(ctx: SessionContext, db: Db, input: { tripId: string; updateId: string }): Promise<void> {
  const participant = await requireParticipant(ctx, db, input.tripId)
  requireManager(participant)
  await db
    .update(tripUpdates)
    .set({ emailedAt: null })
    .where(and(eq(tripUpdates.id, input.updateId), eq(tripUpdates.tripId, input.tripId)))
}

/** Whoever wrote a post can take it down. The household can take down anything. */
export async function deleteTripUpdate(ctx: SessionContext, db: Db, input: { tripId: string; updateId: string }): Promise<TripUpdatesView> {
  const participant = await requireParticipant(ctx, db, input.tripId)
  const [row] = await db
    .select({ kind: tripUpdates.kind, authorUserId: tripUpdates.authorUserId })
    .from(tripUpdates)
    .where(and(eq(tripUpdates.id, input.updateId), eq(tripUpdates.tripId, input.tripId)))
    .limit(1)
  if (!row) throw new NotFoundError(UPDATE_NOT_FOUND)
  const own = row.kind === 'post' && row.authorUserId === ctx.userId && participant.canVote
  if (!participant.canManage && !own) throw new ForbiddenError('You can only take down your own posts.')
  await db.delete(tripUpdates).where(eq(tripUpdates.id, input.updateId))
  return loadUpdates(db, participant)
}

/** Anyone on the trip, viewers included, can stop the emails. They still see updates on the trip. */
export async function setTripUpdatesMuted(
  ctx: SessionContext,
  db: Db,
  input: { tripId: string; muted: boolean }
): Promise<TripUpdatesView> {
  const participant = await requireParticipant(ctx, db, input.tripId)
  if (input.muted) {
    await db.insert(tripUpdateMutes).values({ tripId: input.tripId, userId: ctx.userId }).onConflictDoNothing()
  } else {
    await db.delete(tripUpdateMutes).where(and(eq(tripUpdateMutes.tripId, input.tripId), eq(tripUpdateMutes.userId, ctx.userId)))
  }
  return loadUpdates(db, participant)
}

// The daily email -----------------------------------------------------------------------------

/** The household's trips with something not yet emailed. */
export async function listTripsWithUnsentUpdates(actor: Actor, db: Db): Promise<string[]> {
  authorize(actor, 'travel.view')
  const rows = await db
    .selectDistinct({ id: trips.id })
    .from(tripUpdates)
    .innerJoin(trips, eq(trips.id, tripUpdates.tripId))
    .where(and(eq(trips.householdId, actor.householdId), isNull(tripUpdates.emailedAt)))
  return rows.map(row => row.id)
}

/**
 * Marks everything not yet emailed on a trip as sent, and hands it back with who to send it to.
 * Null when another run got there first. Give it back with releaseTripUpdates if nothing went.
 */
export async function claimTripUpdates(actor: Actor, db: Db, tripId: string): Promise<TripUpdateBatch | null> {
  authorize(actor, 'travel.view')
  const claimed = await db
    .update(tripUpdates)
    .set({ emailedAt: sql`now()` })
    .where(
      and(
        eq(tripUpdates.tripId, tripId),
        isNull(tripUpdates.emailedAt),
        inArray(tripUpdates.tripId, db.select({ id: trips.id }).from(trips).where(eq(trips.householdId, actor.householdId)))
      )
    )
    .returning({ id: tripUpdates.id })
  if (claimed.length === 0) return null
  return loadBatch(
    db,
    actor.householdId,
    tripId,
    claimed.map(row => row.id)
  )
}

export async function releaseTripUpdates(actor: Actor, db: Db, updateIds: readonly string[]): Promise<void> {
  authorize(actor, 'travel.view')
  if (updateIds.length === 0) return
  await db
    .update(tripUpdates)
    .set({ emailedAt: null })
    .where(
      and(
        inArray(tripUpdates.id, [...updateIds]),
        inArray(tripUpdates.tripId, db.select({ id: trips.id }).from(trips).where(eq(trips.householdId, actor.householdId)))
      )
    )
}

async function loadBatch(db: Db, householdId: string, tripId: string, updateIds: readonly string[]): Promise<TripUpdateBatch | null> {
  const [trip] = await db
    .select({ id: trips.id, name: trips.name, householdName: households.name })
    .from(trips)
    .innerJoin(households, eq(households.id, trips.householdId))
    .where(and(eq(trips.id, tripId), eq(trips.householdId, householdId)))
    .limit(1)
  if (!trip) return null
  const [rows, recipients] = await Promise.all([
    db
      .select(updateColumns)
      .from(tripUpdates)
      .leftJoin(profiles, eq(profiles.id, tripUpdates.authorUserId))
      .where(and(eq(tripUpdates.tripId, tripId), inArray(tripUpdates.id, [...updateIds])))
      .orderBy(tripUpdates.createdAt, tripUpdates.id),
    listTripRecipients(db, householdId, tripId),
  ])
  return {
    trip,
    updates: rows.map(({ authorName, ...row }) => ({ ...row, author: firstName(authorName) })),
    recipients,
  }
}
