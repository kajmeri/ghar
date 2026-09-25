import { can, type HouseholdRole } from './auth'
import type { CalendarDate } from './dates'
import { ValidationError } from './errors'

// Health records: what happened, to whom and when. A flu shot, a checkup, a filling, an eye test.
// Each belongs to one of the household's people. Owners and adults see and log everyone's, children
// included; everyone else sees only their own, and members can log their own. Detail stays light on
// purpose: a title and a short note, never results or diagnoses as data. A scan of a report belongs
// in documents, marked sensitive.

export const HEALTH_EVENT_KINDS = ['vaccine', 'checkup', 'dental', 'eye', 'visit', 'test'] as const
export type HealthEventKind = (typeof HEALTH_EVENT_KINDS)[number]

export const HEALTH_TITLE_MAX_LENGTH = 120
export const HEALTH_NOTE_MAX_LENGTH = 1000
/** Nothing is logged from before this. A typo like 0224 gets caught instead. */
export const HEALTH_EARLIEST_DATE = '1900-01-01'

export function isHealthEventKind(value: string): value is HealthEventKind {
  return (HEALTH_EVENT_KINDS as readonly string[]).includes(value)
}

/** Who is asking, and whose record it is. `personUserId` is null for someone without an account. */
export interface HealthViewer {
  readonly role: HouseholdRole
  readonly userId: string
}

/** Owners and adults see everyone's. Anyone else sees a record only when it's theirs. */
export function canSeeHealthOf(viewer: HealthViewer, personUserId: string | null): boolean {
  if (can(viewer.role, 'health.everyone')) return true
  return can(viewer.role, 'health.view') && personUserId === viewer.userId
}

/** Owners and adults log for anyone. Members log for themselves. Viewers log nothing. */
export function canManageHealthOf(viewer: HealthViewer, personUserId: string | null): boolean {
  if (can(viewer.role, 'health.everyone')) return true
  return can(viewer.role, 'health.manage') && personUserId === viewer.userId
}

/** Something that already happened: not before 1900, and not after today where the household is. */
export function requireHealthEventDate(occurredOn: CalendarDate, today: CalendarDate): void {
  const problem =
    occurredOn > today
      ? 'That date hasn’t happened yet. Log it once it has.'
      : occurredOn < HEALTH_EARLIEST_DATE
        ? 'That date is too far back.'
        : null
  if (problem) throw new ValidationError(problem, { details: { fieldErrors: { occurredOn: [problem] } } })
}

/** What each kind is called, and the title a record gets when nobody typed one. */
export const HEALTH_KIND_LABELS: Record<HealthEventKind, string> = {
  vaccine: 'Vaccine',
  checkup: 'Checkup',
  dental: 'Dentist',
  eye: 'Eye test',
  visit: 'Doctor’s visit',
  test: 'Test',
}

/** The title typed, trimmed, or the kind's name when it's blank. "Flu shot" beats "Vaccine", but "Dentist" is enough. */
export function healthEventTitle(kind: HealthEventKind, title: string | null): string {
  const trimmed = title?.trim() ?? ''
  if (trimmed.length > HEALTH_TITLE_MAX_LENGTH) {
    throw new ValidationError('That title is too long.', { details: { fieldErrors: { title: ['That title is too long.'] } } })
  }
  return trimmed === '' ? HEALTH_KIND_LABELS[kind] : trimmed
}

/** Newest first, then by id so records on one day hold still. */
export function compareHealthEvents(a: { occurredOn: CalendarDate; id: string }, b: { occurredOn: CalendarDate; id: string }): number {
  if (a.occurredOn !== b.occurredOn) return a.occurredOn < b.occurredOn ? 1 : -1
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

/** Records by the year they happened in, newest year first, each year newest first. */
export function groupHealthEventsByYear<Event extends { occurredOn: CalendarDate; id: string }>(
  events: readonly Event[]
): { year: string; events: Event[] }[] {
  const years = new Map<string, Event[]>()
  for (const event of events.toSorted(compareHealthEvents)) {
    const year = event.occurredOn.slice(0, 4)
    const list = years.get(year)
    if (list) list.push(event)
    else years.set(year, [event])
  }
  return [...years].map(([year, list]) => ({ year, events: list }))
}
