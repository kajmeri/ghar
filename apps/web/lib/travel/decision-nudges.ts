import 'server-only'
import { todayInTimeZone } from '@ghar/core/dates'
import { nudgesDue } from '@ghar/core/trip-polls'
import * as queries from '@ghar/db/queries'
import type { Db, NudgeTrip, ReminderHousehold, SystemContext } from '@ghar/db/queries'
import { decisionNudgeEmail, type DecisionNudgeItem } from '@/lib/email/decision-nudge'
import type { EmailProvider } from '@/lib/providers/email'

// The daily nudge to vote. For each trip that hasn't ended, anything up for a vote whose deadline
// is inside the itinerary's "soon" (an open slot's decide-by or earliest booking deadline, or a
// poll's decide-by) gets one email per person who can vote and hasn't: household members who can
// plan, and guests let on who haven't said no. Each reminder is claimed with a row per person and
// deadline before the email goes, so a second run sends nothing; a failed email gives its claims
// back for tomorrow. One household's, trip's or person's trouble never stops the rest.

export interface DecisionNudgeDeps {
  db: Db
  email: EmailProvider
  /** Origin for the link in the email, without a trailing slash. */
  appUrl: string
  now: Date
}

export type DecisionNudgeResult = {
  households: number
  /** Trips with something up for a vote. */
  trips: number
  emails: number
  /** Households, trips or people where something unexpected went wrong. Logged, and the rest carried on. */
  errors: number
}

export async function runDecisionNudges(deps: DecisionNudgeDeps, options: { householdId?: string } = {}): Promise<DecisionNudgeResult> {
  const result: DecisionNudgeResult = { households: 0, trips: 0, emails: 0, errors: 0 }
  for (const household of await queries.listHouseholdsForReminders(deps.db)) {
    if (options.householdId !== undefined && household.id !== options.householdId) continue
    result.households += 1
    try {
      await nudgeHousehold(deps, household, result)
    } catch (error) {
      result.errors += 1
      console.error(`Decision nudges failed for household ${household.id}`, error)
    }
  }
  return result
}

async function nudgeHousehold(deps: DecisionNudgeDeps, household: ReminderHousehold, result: DecisionNudgeResult): Promise<void> {
  // The household comes from the stored row, never from a request.
  const actor: SystemContext = { householdId: household.id, userId: null }
  const today = todayInTimeZone(household.timezone, deps.now)
  for (const trip of await queries.listTripsForNudges(actor, deps.db, { today })) {
    result.trips += 1
    const due = nudgesDue({
      subjects: trip.subjects,
      voterIds: trip.voters.map(voter => voter.userId),
      nudged: trip.nudged,
      timeZone: household.timezone,
      now: deps.now,
    })
    for (const [userId, keys] of due) {
      try {
        if (await nudgePerson(deps, { actor, household, trip, today }, userId, keys)) result.emails += 1
      } catch (error) {
        result.errors += 1
        console.error(`Decision nudge failed for trip ${trip.id}`, error)
      }
    }
  }
}

async function nudgePerson(
  deps: DecisionNudgeDeps,
  run: { actor: SystemContext; household: ReminderHousehold; trip: NudgeTrip; today: string },
  userId: string,
  keys: readonly string[]
): Promise<boolean> {
  const voter = run.trip.voters.find(each => each.userId === userId)
  if (!voter) return false
  const claims: string[] = []
  const items: DecisionNudgeItem[] = []
  for (const key of keys) {
    const subject = run.trip.subjects.find(each => each.key === key)
    if (!subject?.deadline) continue
    const claim = await queries.claimDecisionNudge(run.actor, deps.db, {
      userId,
      kind: subject.kind,
      subjectId: subject.id,
      deadline: subject.deadline,
    })
    // Another run got there first.
    if (claim === null) continue
    claims.push(claim)
    items.push({ label: subject.label, day: subject.day, deadline: subject.deadline })
  }
  if (items.length === 0) return false

  const path = voter.access === 'guest' ? `/shared/${run.trip.id}` : `/travel/${run.trip.id}`
  try {
    await deps.email.send(
      decisionNudgeEmail({
        to: voter.email,
        householdName: run.household.name,
        tripName: run.trip.name,
        items,
        today: run.today,
        url: `${deps.appUrl}${path}`,
      })
    )
  } catch (error) {
    await queries.releaseDecisionNudges(run.actor, deps.db, claims)
    throw error
  }
  return true
}
