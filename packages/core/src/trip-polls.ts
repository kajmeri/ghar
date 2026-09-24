import { addCalendarDays, daysBetween, isCalendarDate, type CalendarDate, type TimeZone } from './dates'
import { ConflictError, ValidationError } from './errors'
import { deadlineState, tallyOptionVotes, type OptionVote } from './itinerary'

// Deciding a trip together, before it has dates or a place: a "When works?" poll of date ranges
// and a "Where to?" poll of places. Everyone on the trip answers, household and guests alike;
// the household picks, and the pick becomes the trip's dates or destination. The same yes, maybe
// and no as the itinerary's votes, so the two read alike.

export const POLL_KINDS = ['dates', 'place'] as const
export type PollKind = (typeof POLL_KINDS)[number]

export const POLL_TITLES: Record<PollKind, string> = {
  dates: 'When works?',
  place: 'Where to?',
}

/** For dates the answer is about the person, not the option, so it reads that way. */
export const POLL_VOTE_LABELS: Record<PollKind, Record<OptionVote, string>> = {
  dates: { yes: 'Works', maybe: 'Maybe', no: 'Can’t' },
  place: { yes: 'Yes', maybe: 'Maybe', no: 'No' },
}

/** Options on one poll. More than this is a list, not a choice. */
export const MAX_POLL_OPTIONS = 12
/** The longest date range a poll can offer. */
export const MAX_POLL_TRIP_DAYS = 60
export const POLL_PLACE_MAX_LENGTH = 120

export type PollOptionInput = { readonly startsOn: string; readonly endsOn: string } | { readonly label: string }

/** What's stored: a date range for a dates poll, a place for a place poll. */
export interface PollOptionValue {
  readonly startsOn: CalendarDate | null
  readonly endsOn: CalendarDate | null
  readonly label: string | null
}

/**
 * Checks an option against its poll, and tidies a place's spacing. A range can start today at the
 * earliest, in the host's zone, since nobody picks dates that have gone.
 */
export function pollOptionValue(kind: PollKind, input: PollOptionInput, today: CalendarDate): PollOptionValue {
  if (kind === 'dates') {
    if (!('startsOn' in input))
      throw new ValidationError('Pick the dates.', { details: { fieldErrors: { startsOn: ['Pick the dates.'] } } })
    const { startsOn, endsOn } = input
    if (!isCalendarDate(startsOn) || !isCalendarDate(endsOn)) {
      throw new ValidationError('Those aren’t dates.', { details: { fieldErrors: { startsOn: ['Those aren’t dates.'] } } })
    }
    if (endsOn < startsOn)
      throw new ValidationError('The end is before the start.', { details: { fieldErrors: { endsOn: ['The end is before the start.'] } } })
    if (startsOn < today)
      throw new ValidationError('Those dates have passed.', { details: { fieldErrors: { startsOn: ['Those dates have passed.'] } } })
    if (daysBetween(startsOn, endsOn) + 1 > MAX_POLL_TRIP_DAYS) {
      const message = `Up to ${String(MAX_POLL_TRIP_DAYS)} days.`
      throw new ValidationError(message, { details: { fieldErrors: { endsOn: [message] } } })
    }
    return { startsOn, endsOn, label: null }
  }
  if (!('label' in input)) throw new ValidationError('Name the place.', { details: { fieldErrors: { label: ['Name the place.'] } } })
  const label = input.label.trim().replace(/\s+/g, ' ')
  if (label.length === 0) throw new ValidationError('Name the place.', { details: { fieldErrors: { label: ['Name the place.'] } } })
  if (label.length > POLL_PLACE_MAX_LENGTH) {
    const message = `Up to ${String(POLL_PLACE_MAX_LENGTH)} characters.`
    throw new ValidationError(message, { details: { fieldErrors: { label: [message] } } })
  }
  return { startsOn: null, endsOn: null, label }
}

/** The same dates, or the same place whatever its capitals. */
export function samePollOption(a: PollOptionValue, b: PollOptionValue): boolean {
  if (a.label !== null || b.label !== null) return a.label?.toLowerCase() === b.label?.toLowerCase()
  return a.startsOn === b.startsOn && a.endsOn === b.endsOn
}

/** Refuses a duplicate, or one option too many. */
export function assertPollOptionFits(existing: readonly PollOptionValue[], next: PollOptionValue): void {
  if (existing.some(option => samePollOption(option, next))) throw new ConflictError('That’s already an option.')
  if (existing.length >= MAX_POLL_OPTIONS) throw new ConflictError(`A poll holds up to ${String(MAX_POLL_OPTIONS)} options.`)
}

export interface PollVoteRow {
  readonly userId: string
  readonly vote: OptionVote
}

export interface PollTally {
  readonly yes: number
  readonly maybe: number
  readonly no: number
  readonly score: number
  readonly voters: number
}

export function tallyPollVotes(votes: readonly PollVoteRow[]): PollTally {
  return tallyOptionVotes(votes)
}

/**
 * The option ahead, if one clearly is: the most yes, with a no counting against. Dates are about
 * who can come, so for them a no counts double. Ties have no leader.
 */
export function pollLeader(
  kind: PollKind,
  options: readonly { readonly id: string; readonly votes: readonly PollVoteRow[] }[]
): string | null {
  const scored = options
    .map(option => {
      const tally = tallyPollVotes(option.votes)
      return { id: option.id, voters: tally.voters, score: tally.yes - tally.no * (kind === 'dates' ? 2 : 1) }
    })
    .filter(each => each.voters > 0)
    .sort((a, b) => b.score - a.score)
  const [first, second] = scored
  if (!first || first.score <= 0) return null
  return second?.score === first.score ? null : first.id
}

/** Trip dates from a picked range, checked the same way the trip form checks them. */
export function tripDatesFromOption(option: PollOptionValue): { startsOn: CalendarDate; endsOn: CalendarDate } {
  if (option.startsOn === null || option.endsOn === null) throw new ValidationError('That option has no dates.')
  return { startsOn: option.startsOn, endsOn: option.endsOn }
}

// Nudges -----------------------------------------------------------------------------------------

/** Something up for a vote with a date it should be settled by: an open slot, or a poll. */
export interface NudgeSubject {
  /** Stable across runs: `slot:<id>` or `poll:<id>`. */
  readonly key: string
  readonly deadline: CalendarDate | null
  /** At least one option, or there's nothing to vote on. */
  readonly optionCount: number
  /** Everyone who has voted on any of its options. */
  readonly voterIds: ReadonlySet<string>
}

/**
 * Who to remind about what, once each: everyone on the trip who can vote and hasn't, on anything
 * whose deadline is inside DEADLINE_SOON_HOURS (the itinerary's "soon") and hasn't passed.
 * `nudged` is `${key}|${userId}` for reminders already sent. The result maps an account to the
 * subjects its one email covers.
 */
export function nudgesDue(input: {
  subjects: readonly NudgeSubject[]
  voterIds: readonly string[]
  nudged: ReadonlySet<string>
  timeZone: TimeZone
  now: Date
}): Map<string, string[]> {
  const due = new Map<string, string[]>()
  for (const subject of input.subjects) {
    if (subject.deadline === null || subject.optionCount === 0) continue
    if (deadlineState(subject.deadline, input.timeZone, input.now) !== 'soon') continue
    for (const userId of input.voterIds) {
      if (subject.voterIds.has(userId) || input.nudged.has(`${subject.key}|${userId}`)) continue
      const list = due.get(userId) ?? []
      list.push(subject.key)
      due.set(userId, list)
    }
  }
  return due
}

/** The last day a poll can be set to be decided by: no sooner than today. */
export function assertDecideBy(decideBy: CalendarDate | null, today: CalendarDate): void {
  if (decideBy !== null && decideBy < today) {
    throw new ValidationError('That date has passed.', { details: { fieldErrors: { decideBy: ['That date has passed.'] } } })
  }
  if (decideBy !== null && decideBy > addCalendarDays(today, 366)) {
    throw new ValidationError('Within a year.', { details: { fieldErrors: { decideBy: ['Within a year.'] } } })
  }
}
