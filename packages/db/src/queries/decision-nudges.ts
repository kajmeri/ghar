import { can } from '@ghar/core/auth'
import type { CalendarDate } from '@ghar/core/dates'
import { decisionDeadline } from '@ghar/core/itinerary'
import { POLL_TITLES, type PollKind } from '@ghar/core/trip-polls'
import { and, eq, gte, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm'
import { authUsers } from 'drizzle-orm/supabase'
import {
  decisionNudges,
  householdMembers,
  itineraryOptions,
  itinerarySlots,
  optionVotes,
  profiles,
  tripGuests,
  tripPollOptions,
  tripPolls,
  tripPollVotes,
  trips,
} from '../schema'
import { authorize } from './authorize'
import type { Actor, Db } from './types'

// Reminders to vote, sent by the daily job to everyone on a trip who hasn't voted on something
// whose deadline is close: an open slot with options, or a poll with a date to decide by. Each is
// claimed with a row per person and deadline before it goes out, so a second run sends nothing
// and moving a deadline earns one more.

export interface NudgeSubjectRow {
  /** `slot:<id>` or `poll:<id>`, as nudgesDue in @ghar/core/trip-polls keys them. */
  key: string
  kind: 'slot' | 'poll'
  id: string
  /** "Dinner on Oct 3", or a poll's question. The job words it. */
  label: string
  day: CalendarDate | null
  deadline: CalendarDate | null
  optionCount: number
  voterIds: Set<string>
}

export interface NudgeVoter {
  userId: string
  email: string
  name: string | null
  /** Where their link goes: the trip in the app, or the guest's page. */
  access: 'household' | 'guest'
}

export interface NudgeTrip {
  id: string
  name: string
  subjects: NudgeSubjectRow[]
  voters: NudgeVoter[]
  /** `${key}|${userId}` for reminders already sent at each subject's current deadline. */
  nudged: Set<string>
}

/**
 * The household's trips that haven't ended, with everything on them up for a vote and everyone
 * who can vote: members who can manage travel, and guests let on who haven't said they're not
 * going. Trips with nothing up for a vote are left out.
 */
export async function listTripsForNudges(actor: Actor, db: Db, input: { today: CalendarDate }): Promise<NudgeTrip[]> {
  authorize(actor, 'travel.manage')
  const tripRows = await db
    .select({ id: trips.id, name: trips.name })
    .from(trips)
    .where(and(eq(trips.householdId, actor.householdId), or(isNull(trips.endsOn), gte(trips.endsOn, input.today))))
  if (tripRows.length === 0) return []
  const tripIds = tripRows.map(trip => trip.id)

  const [slotRows, optionRows, slotVotes, pollRows, pollOptionRows, pollVotes] = await Promise.all([
    db
      .select({
        id: itinerarySlots.id,
        tripId: itinerarySlots.tripId,
        day: itinerarySlots.day,
        band: itinerarySlots.band,
        label: itinerarySlots.label,
        startsAt: itinerarySlots.startsAt,
        sortOrder: itinerarySlots.sortOrder,
        status: itinerarySlots.status,
        chosenOptionId: itinerarySlots.chosenOptionId,
        decideBy: itinerarySlots.decideBy,
      })
      .from(itinerarySlots)
      .where(and(inArray(itinerarySlots.tripId, tripIds), eq(itinerarySlots.status, 'open'), ne(itinerarySlots.kind, 'note'))),
    db
      .select({
        id: itineraryOptions.id,
        slotId: itineraryOptions.slotId,
        status: itineraryOptions.status,
        sortOrder: itineraryOptions.sortOrder,
        bookingId: itineraryOptions.bookingId,
        bookingRequired: itineraryOptions.bookingRequired,
        bookingDeadline: itineraryOptions.bookingDeadline,
      })
      .from(itineraryOptions)
      .innerJoin(itinerarySlots, eq(itinerarySlots.id, itineraryOptions.slotId))
      .where(and(inArray(itinerarySlots.tripId, tripIds), eq(itinerarySlots.status, 'open'), eq(itineraryOptions.status, 'candidate'))),
    db
      .select({ slotId: itineraryOptions.slotId, userId: optionVotes.userId })
      .from(optionVotes)
      .innerJoin(itineraryOptions, eq(itineraryOptions.id, optionVotes.optionId))
      .innerJoin(itinerarySlots, eq(itinerarySlots.id, itineraryOptions.slotId))
      .where(and(inArray(itinerarySlots.tripId, tripIds), eq(itinerarySlots.status, 'open'))),
    db
      .select({ id: tripPolls.id, tripId: tripPolls.tripId, kind: tripPolls.kind, decideBy: tripPolls.decideBy })
      .from(tripPolls)
      .where(and(inArray(tripPolls.tripId, tripIds), isNotNull(tripPolls.decideBy))),
    db
      .select({ pollId: tripPollOptions.pollId })
      .from(tripPollOptions)
      .innerJoin(tripPolls, eq(tripPolls.id, tripPollOptions.pollId))
      .where(inArray(tripPolls.tripId, tripIds)),
    db
      .select({ pollId: tripPollOptions.pollId, userId: tripPollVotes.userId })
      .from(tripPollVotes)
      .innerJoin(tripPollOptions, eq(tripPollOptions.id, tripPollVotes.optionId))
      .innerJoin(tripPolls, eq(tripPolls.id, tripPollOptions.pollId))
      .where(inArray(tripPolls.tripId, tripIds)),
  ])

  const subjectsByTrip = new Map<string, NudgeSubjectRow[]>()
  const add = (tripId: string, subject: NudgeSubjectRow) => {
    if (subject.deadline === null || subject.optionCount === 0) return
    const list = subjectsByTrip.get(tripId) ?? []
    list.push(subject)
    subjectsByTrip.set(tripId, list)
  }
  for (const slot of slotRows) {
    const options = optionRows.filter(option => option.slotId === slot.id)
    add(slot.tripId, {
      key: `slot:${slot.id}`,
      kind: 'slot',
      id: slot.id,
      label: slot.label,
      day: slot.day,
      deadline: decisionDeadline({ ...slot, options }),
      optionCount: options.length,
      voterIds: new Set(slotVotes.filter(vote => vote.slotId === slot.id).map(vote => vote.userId)),
    })
  }
  for (const poll of pollRows) {
    add(poll.tripId, {
      key: `poll:${poll.id}`,
      kind: 'poll',
      id: poll.id,
      label: POLL_TITLES[poll.kind satisfies PollKind],
      day: null,
      deadline: poll.decideBy,
      optionCount: pollOptionRows.filter(option => option.pollId === poll.id).length,
      voterIds: new Set(pollVotes.filter(vote => vote.pollId === poll.id).map(vote => vote.userId)),
    })
  }
  const withSubjects = tripRows.filter(trip => subjectsByTrip.has(trip.id))
  if (withSubjects.length === 0) return []

  const [members, guests, sent] = await Promise.all([
    db
      .select({ userId: householdMembers.userId, role: householdMembers.role, email: authUsers.email, name: profiles.fullName })
      .from(householdMembers)
      .innerJoin(authUsers, eq(authUsers.id, householdMembers.userId))
      .leftJoin(profiles, eq(profiles.id, householdMembers.userId))
      .where(eq(householdMembers.householdId, actor.householdId)),
    db
      .select({ tripId: tripGuests.tripId, userId: tripGuests.userId, email: authUsers.email, name: profiles.fullName })
      .from(tripGuests)
      .innerJoin(authUsers, eq(authUsers.id, tripGuests.userId))
      .leftJoin(profiles, eq(profiles.id, tripGuests.userId))
      .where(
        and(
          inArray(tripGuests.tripId, tripIds),
          isNotNull(tripGuests.approvedAt),
          or(isNull(tripGuests.response), ne(tripGuests.response, 'not_going'))
        )
      ),
    db
      .select({
        slotId: decisionNudges.slotId,
        pollId: decisionNudges.pollId,
        userId: decisionNudges.userId,
        deadline: decisionNudges.deadline,
      })
      .from(decisionNudges)
      .where(
        or(
          slotRows.length > 0
            ? inArray(
                decisionNudges.slotId,
                slotRows.map(slot => slot.id)
              )
            : undefined,
          pollRows.length > 0
            ? inArray(
                decisionNudges.pollId,
                pollRows.map(poll => poll.id)
              )
            : undefined
        )
      ),
  ])

  const householdVoters: NudgeVoter[] = []
  for (const member of members) {
    if (!member.email || !can(member.role, 'travel.manage')) continue
    householdVoters.push({ userId: member.userId, email: member.email, name: member.name, access: 'household' })
  }
  const householdIds = new Set(householdVoters.map(voter => voter.userId))

  return withSubjects.map(trip => {
    const subjects = subjectsByTrip.get(trip.id) ?? []
    const deadlines = new Map(subjects.map(subject => [subject.key, subject.deadline]))
    const nudged = new Set<string>()
    for (const row of sent) {
      const key = row.slotId ? `slot:${row.slotId}` : `poll:${row.pollId ?? ''}`
      if (deadlines.get(key) === row.deadline) nudged.add(`${key}|${row.userId}`)
    }
    const tripGuestVoters: NudgeVoter[] = []
    for (const guest of guests) {
      if (guest.tripId !== trip.id || !guest.userId || !guest.email || householdIds.has(guest.userId)) continue
      tripGuestVoters.push({ userId: guest.userId, email: guest.email, name: guest.name, access: 'guest' })
    }
    return { ...trip, subjects, voters: [...householdVoters, ...tripGuestVoters], nudged }
  })
}

/**
 * Claims one reminder for one person about one subject at its current deadline. Null when it was
 * already sent, or another run got there first.
 */
export async function claimDecisionNudge(
  actor: Actor,
  db: Db,
  input: { userId: string; kind: 'slot' | 'poll'; subjectId: string; deadline: CalendarDate }
): Promise<string | null> {
  authorize(actor, 'travel.manage')
  const [row] = await db
    .insert(decisionNudges)
    .values({
      userId: input.userId,
      slotId: input.kind === 'slot' ? input.subjectId : null,
      pollId: input.kind === 'poll' ? input.subjectId : null,
      deadline: input.deadline,
    })
    .onConflictDoNothing()
    .returning({ id: decisionNudges.id })
  return row?.id ?? null
}

/** Gives back claims whose email didn't go, so tomorrow's run tries again. */
export async function releaseDecisionNudges(actor: Actor, db: Db, ids: readonly string[]): Promise<void> {
  authorize(actor, 'travel.manage')
  if (ids.length === 0) return
  await db.delete(decisionNudges).where(inArray(decisionNudges.id, [...ids]))
}
