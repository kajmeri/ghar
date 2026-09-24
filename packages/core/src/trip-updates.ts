import { formatCalendarDate, type CalendarDate } from './dates'
import { ValidationError } from './errors'
import { formatTripDates } from './trips'

// What's new on a trip, for everyone on it: posts people write, and what the household decides,
// which posts itself. An automatic update only ever says what guests can already see on the plan:
// a slot's name, day and choice, a booking's place on the plan, the trip's dates and destination.
// Never a cost, a note or a confirmation code.

export const TRIP_UPDATE_KINDS = ['post', 'decided', 'booked', 'dates', 'destination'] as const
export type TripUpdateKind = (typeof TRIP_UPDATE_KINDS)[number]

/** The kinds that post themselves. */
export type AutomaticUpdateKind = Exclude<TripUpdateKind, 'post'>

export const TRIP_POST_MAX_LENGTH = 2000
/** The most a trip shows at once, newest first. */
export const TRIP_UPDATES_PAGE_SIZE = 30

/**
 * A post as it's stored: trimmed, with runs of blank lines folded to one, so a pasted message
 * doesn't arrive as a wall of gaps.
 */
export function tripPostBody(raw: string): string {
  const body = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (body.length === 0)
    throw new ValidationError('Write something first.', { details: { fieldErrors: { body: ['Write something first.'] } } })
  if (body.length > TRIP_POST_MAX_LENGTH) {
    const message = `Up to ${String(TRIP_POST_MAX_LENGTH)} characters.`
    throw new ValidationError(message, { details: { fieldErrors: { body: [message] } } })
  }
  return body
}

/** The fields an update is stored with. Which are set depends on the kind. */
export interface TripUpdateFields {
  readonly kind: TripUpdateKind
  /** A post's text. */
  readonly body: string | null
  /** A slot's name, "Dinner". */
  readonly label: string | null
  /** A slot's day, or the first of the trip's new dates. */
  readonly day: CalendarDate | null
  /** The last of the trip's new dates. */
  readonly endsOn: CalendarDate | null
  /** What was chosen or booked, or the new destination. */
  readonly detail: string | null
}

export const TRIP_UPDATE_TITLES: Record<AutomaticUpdateKind, string> = {
  decided: 'Decided',
  booked: 'Booked',
  dates: 'Dates set',
  destination: 'Destination set',
}

/**
 * One line for an update that posted itself: "Dinner, Sat, Mar 13: Cervejaria Ramiro", or "Mar
 * 12 – 15, 2027". Null for a post, which is its own words.
 */
export function tripUpdateText(update: TripUpdateFields): string | null {
  switch (update.kind) {
    case 'post':
      return null
    case 'decided':
    case 'booked': {
      const when = update.day ? `, ${formatCalendarDate(update.day, 'EEE, MMM d')}` : ''
      const what = update.detail ? `: ${update.detail}` : ''
      return `${update.label ?? 'Plan'}${when}${what}`
    }
    case 'dates':
      return formatTripDates({ startsOn: update.day, endsOn: update.endsOn }) || 'No dates yet'
    case 'destination':
      return update.detail ?? 'No destination yet'
  }
}

/** What someone's digest holds: everything since the last one, less what they did themselves. */
export function updatesFor<T extends { readonly authorUserId: string | null }>(updates: readonly T[], userId: string): T[] {
  return updates.filter(update => update.authorUserId !== userId)
}
