import { can } from '@ghar/core/auth'
import { todayInTimeZone, type CalendarDate } from '@ghar/core/dates'
import { ConflictError, ForbiddenError, NotFoundError } from '@ghar/core/errors'
import { SORT_ORDER_STEP, type OptionVote } from '@ghar/core/itinerary'
import { firstName } from '@ghar/core/trip-guests'
import {
  assertDecideBy,
  assertPollOptionFits,
  pollLeader,
  pollOptionValue,
  POLL_KINDS,
  POLL_TITLES,
  tallyPollVotes,
  tripDatesFromOption,
  type PollKind,
  type PollOptionInput,
} from '@ghar/core/trip-polls'
import { and, asc, eq, inArray, max, sql } from 'drizzle-orm'
import { households, profiles, tripPollOptions, tripPolls, tripPollVotes, trips } from '../schema'
import { recordAudit } from './audit'
import { isUniqueViolation } from './pg-errors'
import { findMembership } from './session'
import { findTripAccess } from './trip-guests'
import type { Db, SessionContext } from './types'

// "When works?" and "Where to?": deciding a trip together before it has dates or a place. Both
// the household and the trip's guests use these, so they take a SessionContext and work out who
// the caller is to the trip from the session and the trip id in the path, never from a body.
// Everyone who can vote can add options; only the household opens, closes and picks.

const NOT_ON_TRIP = "You're not on that trip."
const POLL_NOT_FOUND = 'That poll has closed.'
const OPTION_NOT_FOUND = 'That option is no longer in the poll.'

interface Participant {
  userId: string
  tripId: string
  hostHouseholdId: string
  timeZone: string
  /** Adds options and votes: the household's contributors, and admitted guests. */
  canVote: boolean
  /** Opens, closes and picks: the household's contributors. */
  canManage: boolean
}

async function requireParticipant(ctx: SessionContext, db: Db, tripId: string): Promise<Participant> {
  const access = await findTripAccess(ctx, db, tripId)
  if (!access) throw new NotFoundError(NOT_ON_TRIP)
  const [zone] = await db
    .select({ timeZone: households.timezone })
    .from(households)
    .where(eq(households.id, access.hostHouseholdId))
    .limit(1)
  if (!zone) throw new NotFoundError(NOT_ON_TRIP)
  const base = { userId: ctx.userId, tripId, hostHouseholdId: access.hostHouseholdId, timeZone: zone.timeZone }
  if (access.access === 'guest') return { ...base, canVote: true, canManage: false }
  const membership = await findMembership(ctx, db)
  const canManage = membership !== null && can(membership.role, 'travel.manage')
  return { ...base, canVote: canManage, canManage }
}

function requireVoter(participant: Participant): void {
  if (!participant.canVote) throw new ForbiddenError('You can look at polls but not vote on them.')
}

function requireManager(participant: Participant): void {
  if (!participant.canManage) throw new ForbiddenError('Only the household hosting the trip can do that.')
}

function auditActor(participant: Participant) {
  return { userId: participant.userId, householdId: participant.hostHouseholdId }
}

// Reading ------------------------------------------------------------------------------------

export interface TripPollOptionView {
  id: string
  startsOn: CalendarDate | null
  endsOn: CalendarDate | null
  label: string | null
  addedBy: string | null
  canDelete: boolean
  yes: number
  maybe: number
  no: number
  myVote: OptionVote | null
}

export interface TripPollView {
  id: string
  kind: PollKind
  title: string
  decideBy: CalendarDate | null
  options: TripPollOptionView[]
  leaderId: string | null
  voters: number
}

export interface TripPollsView {
  polls: TripPollView[]
  canVote: boolean
  canManage: boolean
}

export async function listTripPolls(ctx: SessionContext, db: Db, tripId: string): Promise<TripPollsView> {
  return loadPolls(db, await requireParticipant(ctx, db, tripId))
}

async function loadPolls(db: Db, participant: Participant): Promise<TripPollsView> {
  const polls = await db
    .select({ id: tripPolls.id, kind: tripPolls.kind, decideBy: tripPolls.decideBy })
    .from(tripPolls)
    .where(eq(tripPolls.tripId, participant.tripId))
  const pollIds = polls.map(poll => poll.id)
  const options =
    pollIds.length === 0
      ? []
      : await db
          .select({
            id: tripPollOptions.id,
            pollId: tripPollOptions.pollId,
            startsOn: tripPollOptions.startsOn,
            endsOn: tripPollOptions.endsOn,
            label: tripPollOptions.label,
            createdByUserId: tripPollOptions.createdByUserId,
            createdByName: profiles.fullName,
          })
          .from(tripPollOptions)
          .leftJoin(profiles, eq(profiles.id, tripPollOptions.createdByUserId))
          .where(inArray(tripPollOptions.pollId, pollIds))
          .orderBy(asc(tripPollOptions.sortOrder), asc(tripPollOptions.id))
  const optionIds = options.map(option => option.id)
  const votes =
    optionIds.length === 0
      ? []
      : await db
          .select({ optionId: tripPollVotes.optionId, userId: tripPollVotes.userId, vote: tripPollVotes.vote })
          .from(tripPollVotes)
          .where(inArray(tripPollVotes.optionId, optionIds))

  const votesByOption = new Map<string, { userId: string; vote: OptionVote }[]>()
  for (const vote of votes) {
    const list = votesByOption.get(vote.optionId) ?? []
    list.push(vote)
    votesByOption.set(vote.optionId, list)
  }

  const kindOrder = new Map(POLL_KINDS.map((kind, index) => [kind, index]))
  const views = polls
    .toSorted((a, b) => (kindOrder.get(a.kind) ?? 0) - (kindOrder.get(b.kind) ?? 0))
    .map(poll => {
      const own = options.filter(option => option.pollId === poll.id)
      const voters = new Set<string>()
      const optionViews = own.map(option => {
        const optionVotes = votesByOption.get(option.id) ?? []
        for (const vote of optionVotes) voters.add(vote.userId)
        const tally = tallyPollVotes(optionVotes)
        return {
          id: option.id,
          startsOn: option.startsOn,
          endsOn: option.endsOn,
          label: option.label,
          addedBy: firstName(option.createdByName),
          canDelete: participant.canManage || (participant.canVote && option.createdByUserId === participant.userId),
          yes: tally.yes,
          maybe: tally.maybe,
          no: tally.no,
          myVote: optionVotes.find(vote => vote.userId === participant.userId)?.vote ?? null,
        }
      })
      return {
        id: poll.id,
        kind: poll.kind,
        title: POLL_TITLES[poll.kind],
        decideBy: poll.decideBy,
        options: optionViews,
        leaderId: pollLeader(
          poll.kind,
          own.map(option => ({ id: option.id, votes: votesByOption.get(option.id) ?? [] }))
        ),
        voters: voters.size,
      }
    })
  return { polls: views, canVote: participant.canVote, canManage: participant.canManage }
}

// The household's part ------------------------------------------------------------------------

/** Opens a poll. A trip has one of each kind at most. */
export async function openTripPoll(
  ctx: SessionContext,
  db: Db,
  tripId: string,
  input: { kind: PollKind; decideBy: CalendarDate | null; now: Date }
): Promise<TripPollsView> {
  const participant = await requireParticipant(ctx, db, tripId)
  requireManager(participant)
  assertDecideBy(input.decideBy, todayInTimeZone(participant.timeZone, input.now))
  try {
    await db.transaction(async tx => {
      const [poll] = await tx
        .insert(tripPolls)
        .values({ tripId, kind: input.kind, decideBy: input.decideBy, createdByUserId: ctx.userId })
        .returning({ id: tripPolls.id })
      if (!poll) throw new Error('Poll insert returned no row')
      await recordAudit(auditActor(participant), tx, {
        action: 'trip_poll.opened',
        entity: 'trip_poll',
        entityId: poll.id,
        metadata: { tripId, kind: input.kind },
      })
    })
  } catch (error) {
    if (isUniqueViolation(error, 'trip_polls_trip_kind_unique')) {
      throw new ConflictError(`This trip already asks “${POLL_TITLES[input.kind]}”`)
    }
    throw error
  }
  return loadPolls(db, participant)
}

export async function setTripPollDecideBy(
  ctx: SessionContext,
  db: Db,
  input: { tripId: string; pollId: string; decideBy: CalendarDate | null; now: Date }
): Promise<TripPollsView> {
  const participant = await requireParticipant(ctx, db, input.tripId)
  requireManager(participant)
  assertDecideBy(input.decideBy, todayInTimeZone(participant.timeZone, input.now))
  const [row] = await db
    .update(tripPolls)
    .set({ decideBy: input.decideBy })
    .where(and(eq(tripPolls.id, input.pollId), eq(tripPolls.tripId, input.tripId)))
    .returning({ id: tripPolls.id })
  if (!row) throw new NotFoundError(POLL_NOT_FOUND)
  return loadPolls(db, participant)
}

/** Closes a poll without picking. Its options and votes go with it. */
export async function deleteTripPoll(ctx: SessionContext, db: Db, input: { tripId: string; pollId: string }): Promise<TripPollsView> {
  const participant = await requireParticipant(ctx, db, input.tripId)
  requireManager(participant)
  await db.transaction(async tx => {
    const [row] = await tx
      .delete(tripPolls)
      .where(and(eq(tripPolls.id, input.pollId), eq(tripPolls.tripId, input.tripId)))
      .returning({ id: tripPolls.id, kind: tripPolls.kind })
    if (!row) throw new NotFoundError(POLL_NOT_FOUND)
    await recordAudit(auditActor(participant), tx, {
      action: 'trip_poll.closed',
      entity: 'trip_poll',
      entityId: row.id,
      metadata: { tripId: input.tripId, kind: row.kind },
    })
  })
  return loadPolls(db, participant)
}

/**
 * Settles it: a date range becomes the trip's dates, a place its destination, the same as editing
 * the trip. The poll closes, taking its options and votes.
 */
export async function pickTripPollOption(
  ctx: SessionContext,
  db: Db,
  input: { tripId: string; pollId: string; optionId: string }
): Promise<TripPollsView> {
  const participant = await requireParticipant(ctx, db, input.tripId)
  requireManager(participant)
  await db.transaction(async tx => {
    const poll = await lockPoll(tx, input.tripId, input.pollId)
    const [option] = await tx
      .select({ startsOn: tripPollOptions.startsOn, endsOn: tripPollOptions.endsOn, label: tripPollOptions.label })
      .from(tripPollOptions)
      .where(and(eq(tripPollOptions.id, input.optionId), eq(tripPollOptions.pollId, poll.id)))
      .limit(1)
    if (!option) throw new NotFoundError(OPTION_NOT_FOUND)
    const patch = poll.kind === 'dates' ? tripDatesFromOption(option) : { destination: option.label }
    await tx
      .update(trips)
      .set({ ...patch, updatedAt: sql`now()` })
      .where(and(eq(trips.id, input.tripId), eq(trips.householdId, participant.hostHouseholdId)))
    await tx.delete(tripPolls).where(eq(tripPolls.id, poll.id))
    await recordAudit(auditActor(participant), tx, {
      action: 'trip_poll.picked',
      entity: 'trip_poll',
      entityId: poll.id,
      metadata: { tripId: input.tripId, kind: poll.kind, fields: Object.keys(patch) },
    })
  })
  return loadPolls(db, participant)
}

// Everyone's part -----------------------------------------------------------------------------

/** Locks a poll for the caller's transaction, so two people adding at once can't both slip past the limit. */
async function lockPoll(tx: Db, tripId: string, pollId: string): Promise<{ id: string; kind: PollKind }> {
  const [poll] = await tx
    .select({ id: tripPolls.id, kind: tripPolls.kind })
    .from(tripPolls)
    .where(and(eq(tripPolls.id, pollId), eq(tripPolls.tripId, tripId)))
    .limit(1)
    .for('update')
  if (!poll) throw new NotFoundError(POLL_NOT_FOUND)
  return poll
}

export async function addTripPollOption(
  ctx: SessionContext,
  db: Db,
  input: { tripId: string; pollId: string; option: PollOptionInput; now: Date }
): Promise<TripPollsView> {
  const participant = await requireParticipant(ctx, db, input.tripId)
  requireVoter(participant)
  await db.transaction(async tx => {
    const poll = await lockPoll(tx, input.tripId, input.pollId)
    const value = pollOptionValue(poll.kind, input.option, todayInTimeZone(participant.timeZone, input.now))
    const existing = await tx
      .select({ startsOn: tripPollOptions.startsOn, endsOn: tripPollOptions.endsOn, label: tripPollOptions.label })
      .from(tripPollOptions)
      .where(eq(tripPollOptions.pollId, poll.id))
    assertPollOptionFits(existing, value)
    const [last] = await tx
      .select({ value: max(tripPollOptions.sortOrder) })
      .from(tripPollOptions)
      .where(eq(tripPollOptions.pollId, poll.id))
    await tx.insert(tripPollOptions).values({
      pollId: poll.id,
      ...value,
      createdByUserId: ctx.userId,
      sortOrder: (last?.value ?? 0) + SORT_ORDER_STEP,
    })
  })
  return loadPolls(db, participant)
}

/** Whoever added an option can take it back; the household can take back any. */
export async function deleteTripPollOption(
  ctx: SessionContext,
  db: Db,
  input: { tripId: string; pollId: string; optionId: string }
): Promise<TripPollsView> {
  const participant = await requireParticipant(ctx, db, input.tripId)
  requireVoter(participant)
  const option = await requireOption(db, input)
  if (!participant.canManage && option.createdByUserId !== ctx.userId) {
    throw new ForbiddenError('You can only take back options you added.')
  }
  await db.delete(tripPollOptions).where(eq(tripPollOptions.id, option.id))
  return loadPolls(db, participant)
}

/** One vote per person per option; voting again replaces it and null takes it back. */
export async function voteOnTripPollOption(
  ctx: SessionContext,
  db: Db,
  input: { tripId: string; pollId: string; optionId: string; vote: OptionVote | null }
): Promise<TripPollsView> {
  const participant = await requireParticipant(ctx, db, input.tripId)
  requireVoter(participant)
  const option = await requireOption(db, input)
  if (input.vote === null) {
    await db.delete(tripPollVotes).where(and(eq(tripPollVotes.optionId, option.id), eq(tripPollVotes.userId, ctx.userId)))
  } else {
    await db
      .insert(tripPollVotes)
      .values({ optionId: option.id, userId: ctx.userId, vote: input.vote })
      .onConflictDoUpdate({ target: [tripPollVotes.optionId, tripPollVotes.userId], set: { vote: input.vote } })
  }
  return loadPolls(db, participant)
}

async function requireOption(
  db: Db,
  input: { tripId: string; pollId: string; optionId: string }
): Promise<{ id: string; createdByUserId: string | null }> {
  const [option] = await db
    .select({ id: tripPollOptions.id, createdByUserId: tripPollOptions.createdByUserId })
    .from(tripPollOptions)
    .innerJoin(tripPolls, eq(tripPolls.id, tripPollOptions.pollId))
    .where(and(eq(tripPollOptions.id, input.optionId), eq(tripPolls.id, input.pollId), eq(tripPolls.tripId, input.tripId)))
    .limit(1)
  if (!option) throw new NotFoundError(OPTION_NOT_FOUND)
  return option
}
