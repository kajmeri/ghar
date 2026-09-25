import { can, type HouseholdRole } from './auth'
import { addCalendarMonths, daysBetween, distancePhrase, type CalendarDate } from './dates'
import { ValidationError } from './errors'
import { reminderThreshold } from './expiries'

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

// ---------------------------------------------------------------------------------------------
// What's due: schedules
// ---------------------------------------------------------------------------------------------

// A schedule says how often one person should have one kind of visit: the dentist every six months,
// a flu shot every year. Its next due date is worked out, never stored: the last record that
// matches it, plus the cadence. Logging a visit moves it, and deleting that record moves it back.

export const HEALTH_CADENCE_MONTHS_MIN = 1
export const HEALTH_CADENCE_MONTHS_MAX = 120
/** A schedule turns to caution this many days before it's due. */
export const HEALTH_DUE_SOON_DAYS = 30
/** Reminder emails go this many days ahead, then at 7 days. See reminderTiers in ./expiries. */
export const HEALTH_REMINDER_LEAD_DAYS = 30

/** Starting points for the form, never a national schedule. Everything in one can be changed. */
export interface HealthSchedulePreset {
  readonly key: string
  readonly kind: HealthEventKind
  readonly title: string | null
  readonly cadenceMonths: number
}

export const HEALTH_SCHEDULE_PRESETS: readonly HealthSchedulePreset[] = [
  { key: 'dentist', kind: 'dental', title: null, cadenceMonths: 6 },
  { key: 'checkup', kind: 'checkup', title: null, cadenceMonths: 12 },
  { key: 'eye', kind: 'eye', title: null, cadenceMonths: 24 },
  { key: 'flu', kind: 'vaccine', title: 'Flu shot', cadenceMonths: 12 },
]

export interface HealthScheduleFields {
  readonly personId: string
  readonly kind: HealthEventKind
  /** Only records with this title count towards it. Null for any record of the kind. */
  readonly title: string | null
  readonly cadenceMonths: number
  /** It's due no earlier than this, whatever was logged before. */
  readonly firstDueOn: CalendarDate
}

/** A title as a schedule compares it: case, spacing and edges don't matter. */
function comparableTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en')
}

/** Whether a record counts as the visit a schedule asks for: same person, same kind, and its title if it names one. */
export function matchesHealthSchedule(
  schedule: Pick<HealthScheduleFields, 'personId' | 'kind' | 'title'>,
  event: { readonly personId: string; readonly kind: HealthEventKind; readonly title: string }
): boolean {
  if (schedule.personId !== event.personId || schedule.kind !== event.kind) return false
  return schedule.title === null || comparableTitle(schedule.title) === comparableTitle(event.title)
}

export type HealthDueState = 'overdue' | 'due_soon' | 'scheduled'

export interface HealthDue {
  /** The newest record that matches. Null when nothing does yet. */
  lastOn: CalendarDate | null
  dueOn: CalendarDate
  state: HealthDueState
}

/**
 * When a schedule is next due: one cadence after the newest matching record, but never before its
 * first due date. So a schedule set up after years without a visit is due from the day it starts,
 * not years overdue, and a visit logged later moves it on.
 */
export function healthScheduleDue(
  schedule: HealthScheduleFields,
  events: readonly {
    readonly personId: string
    readonly kind: HealthEventKind
    readonly title: string
    readonly occurredOn: CalendarDate
  }[],
  today: CalendarDate
): HealthDue {
  let lastOn: CalendarDate | null = null
  for (const event of events) {
    if (matchesHealthSchedule(schedule, event) && (lastOn === null || event.occurredOn > lastOn)) lastOn = event.occurredOn
  }
  const fromLast = lastOn === null ? null : addCalendarMonths(lastOn, schedule.cadenceMonths)
  const dueOn = fromLast !== null && fromLast > schedule.firstDueOn ? fromLast : schedule.firstDueOn
  return { lastOn, dueOn, state: healthDueState(dueOn, today) }
}

export function healthDueState(dueOn: CalendarDate, today: CalendarDate): HealthDueState {
  const daysLeft = daysBetween(today, dueOn)
  if (daysLeft < 0) return 'overdue'
  return daysLeft <= HEALTH_DUE_SOON_DAYS ? 'due_soon' : 'scheduled'
}

/** The reminder tier a due date is in today (30 or 7 days), or null. Sending each once is the caller's job. */
export function healthReminderThreshold(dueOn: CalendarDate, today: CalendarDate): number | null {
  return reminderThreshold(dueOn, today, HEALTH_REMINDER_LEAD_DAYS)
}

/** "Due in 12 days", "Due today", "3 months overdue". */
export function healthDuePhrase(dueOn: CalendarDate, today: CalendarDate): string {
  if (dueOn === today) return 'Due today'
  return dueOn > today ? `Due in ${distancePhrase(today, dueOn)}` : `${distancePhrase(dueOn, today)} overdue`
}

/** What a schedule is called: its title, or the kind's name. */
export function healthScheduleTitle(schedule: Pick<HealthScheduleFields, 'kind' | 'title'>): string {
  return schedule.title ?? HEALTH_KIND_LABELS[schedule.kind]
}

/** Checks a schedule's own fields and tidies its title. */
export function requireHealthScheduleFields<T extends HealthScheduleFields>(fields: T): T {
  const fieldErrors: Record<string, string[]> = {}
  if (
    !Number.isInteger(fields.cadenceMonths) ||
    fields.cadenceMonths < HEALTH_CADENCE_MONTHS_MIN ||
    fields.cadenceMonths > HEALTH_CADENCE_MONTHS_MAX
  ) {
    fieldErrors.cadenceMonths = ['Pick between 1 month and 10 years.']
  }
  const title = fields.title?.trim() ?? ''
  if (title.length > HEALTH_TITLE_MAX_LENGTH) fieldErrors.title = ['That title is too long.']
  if (fields.firstDueOn < HEALTH_EARLIEST_DATE) fieldErrors.firstDueOn = ['That date is too far back.']
  const [first] = Object.values(fieldErrors)
  if (first?.[0] !== undefined) throw new ValidationError(first[0], { details: { fieldErrors } })
  return { ...fields, title: title === '' ? null : title }
}

/** Soonest first, then by title so the list holds still. */
export function compareHealthDue(a: { dueOn: CalendarDate; title: string }, b: { dueOn: CalendarDate; title: string }): number {
  return a.dueOn.localeCompare(b.dueOn) || a.title.localeCompare(b.title)
}
