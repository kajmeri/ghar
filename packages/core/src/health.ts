import { can, type HouseholdRole } from './auth'
import { addCalendarDays, addCalendarMonths, daysBetween, distancePhrase, type CalendarDate } from './dates'
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

// ---------------------------------------------------------------------------------------------
// Medicines
// ---------------------------------------------------------------------------------------------

// What someone takes now, and what they used to. A name, a dose as they'd say it ("500 mg twice a
// day"), who prescribed it, and when to refill it. Stopping one keeps it, with the day it stopped,
// so the history is still there. The dose is text on purpose: Ghar never does arithmetic on it.

export const MEDICINE_NAME_MAX_LENGTH = 120
export const MEDICINE_DOSE_MAX_LENGTH = 120
export const MEDICINE_SUPPLY_DAYS_MIN = 1
export const MEDICINE_SUPPLY_DAYS_MAX = 365
/** A refill turns to caution this many days before it's due, and the one reminder email goes then. */
export const MEDICINE_REFILL_SOON_DAYS = 7

export interface MedicineFields {
  readonly personId: string
  readonly name: string
  readonly dose: string | null
  readonly startedOn: CalendarDate | null
  /** The first day they no longer took it. Null while they still do. Never after today. */
  readonly stoppedOn: CalendarDate | null
  /** When it needs refilling next. Null when it doesn't, or nobody's tracking it. */
  readonly refillBy: CalendarDate | null
  /** How many days one refill lasts, so "Refilled" can work out the next date. */
  readonly supplyDays: number | null
  readonly note: string | null
}

/**
 * Checks a medicine's fields and tidies them: text trimmed, blanks to null. A stopped medicine needs
 * no refill, so its refill date is dropped. `today` is the household's.
 */
export function requireMedicineFields<T extends MedicineFields>(fields: T, today: CalendarDate): T {
  const fieldErrors: Record<string, string[]> = {}
  const name = fields.name.trim()
  const dose = fields.dose?.trim() ?? ''
  const note = fields.note?.trim() ?? ''
  if (name === '') fieldErrors.name = ['Give it a name.']
  else if (name.length > MEDICINE_NAME_MAX_LENGTH) fieldErrors.name = ['That name is too long.']
  if (dose.length > MEDICINE_DOSE_MAX_LENGTH) fieldErrors.dose = ['That dose is too long.']
  if (note.length > HEALTH_NOTE_MAX_LENGTH) fieldErrors.note = ['That note is too long.']
  if (fields.startedOn !== null && fields.startedOn < HEALTH_EARLIEST_DATE) fieldErrors.startedOn = ['That date is too far back.']
  if (fields.stoppedOn !== null) {
    if (fields.stoppedOn > today) fieldErrors.stoppedOn = ['That date hasn’t happened yet. Stop it on the day it stops.']
    else if (fields.startedOn !== null && fields.stoppedOn < fields.startedOn) fieldErrors.stoppedOn = ['It can’t stop before it started.']
  }
  if (fields.refillBy !== null && fields.refillBy < HEALTH_EARLIEST_DATE) fieldErrors.refillBy = ['That date is too far back.']
  if (
    fields.supplyDays !== null &&
    (!Number.isInteger(fields.supplyDays) || fields.supplyDays < MEDICINE_SUPPLY_DAYS_MIN || fields.supplyDays > MEDICINE_SUPPLY_DAYS_MAX)
  ) {
    fieldErrors.supplyDays = ['Pick between 1 day and a year.']
  }
  const [first] = Object.values(fieldErrors)
  if (first?.[0] !== undefined) throw new ValidationError(first[0], { details: { fieldErrors } })
  return {
    ...fields,
    name,
    dose: dose === '' ? null : dose,
    note: note === '' ? null : note,
    refillBy: fields.stoppedOn === null ? fields.refillBy : null,
  }
}

/** Still being taken. A stopped one stays, as history. */
export function isMedicineCurrent(medicine: { readonly stoppedOn: CalendarDate | null }): boolean {
  return medicine.stoppedOn === null
}

export type MedicineRefillState = 'overdue' | 'due_soon' | 'later'

export function medicineRefillState(refillBy: CalendarDate, today: CalendarDate): MedicineRefillState {
  const daysLeft = daysBetween(today, refillBy)
  if (daysLeft < 0) return 'overdue'
  return daysLeft <= MEDICINE_REFILL_SOON_DAYS ? 'due_soon' : 'later'
}

/** After a refill today, when the next one is due. */
export function nextRefillBy(today: CalendarDate, supplyDays: number): CalendarDate {
  return addCalendarDays(today, supplyDays)
}

/** The reminder tier a refill date is in today: 7 days before, once. Null otherwise. */
export function medicineRefillThreshold(refillBy: CalendarDate, today: CalendarDate): number | null {
  return reminderThreshold(refillBy, today, MEDICINE_REFILL_SOON_DAYS)
}

/** "Refill today", "Refill in 5 days", "Refill 2 days overdue". */
export function refillPhrase(refillBy: CalendarDate, today: CalendarDate): string {
  if (refillBy === today) return 'Refill today'
  return refillBy > today ? `Refill in ${distancePhrase(today, refillBy)}` : `Refill ${distancePhrase(refillBy, today)} overdue`
}

/**
 * Current ones first, by name. Then stopped ones, most recently stopped first, so the history reads
 * backwards like every other list of what happened.
 */
export function compareMedicines(
  a: { readonly name: string; readonly stoppedOn: CalendarDate | null; readonly id: string },
  b: { readonly name: string; readonly stoppedOn: CalendarDate | null; readonly id: string }
): number {
  if ((a.stoppedOn === null) !== (b.stoppedOn === null)) return a.stoppedOn === null ? -1 : 1
  if (a.stoppedOn !== null && b.stoppedOn !== null && a.stoppedOn !== b.stoppedOn) return a.stoppedOn < b.stoppedOn ? 1 : -1
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
}

// ---------------------------------------------------------------------------------------------
// Health card: what a stranger helping would need to know. One per person, all of it optional.
// Allergies and conditions are short phrases as people say them ("Penicillin", "Asthma"), not codes.
// ---------------------------------------------------------------------------------------------

export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const
export type BloodType = (typeof BLOOD_TYPES)[number]

/** One allergy or condition. */
export const HEALTH_CARD_ITEM_MAX_LENGTH = 80
/** Allergies, or conditions, per person. */
export const HEALTH_CARD_ITEMS_MAX = 20
/** The note for whoever's helping, like "Carries an EpiPen in her bag". */
export const HEALTH_CARD_NOTE_MAX_LENGTH = 300

/** "A+", "O−", with a real minus sign. */
export function bloodTypeLabel(bloodType: BloodType): string {
  return bloodType.replace('-', '−')
}

export interface HealthCardFields {
  readonly bloodType: BloodType | null
  readonly allergies: readonly string[]
  readonly conditions: readonly string[]
  /** Their doctor, as a contact. */
  readonly doctorContactId: string | null
  /** A photo or scan of their insurance card, as a document. */
  readonly insuranceDocumentId: string | null
  readonly emergencyNote: string | null
}

/** Trimmed, blanks dropped, and each one once however it was capitalised. */
function tidyItems(items: readonly string[]): string[] {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const item of items) {
    const trimmed = item.trim().replace(/\s+/g, ' ')
    const key = trimmed.toLowerCase()
    if (trimmed === '' || seen.has(key)) continue
    seen.add(key)
    kept.push(trimmed)
  }
  return kept
}

/** Checks a health card and tidies it: lists trimmed and deduplicated, a blank note to null. */
export function requireHealthCardFields<T extends HealthCardFields>(fields: T): T {
  const fieldErrors: Record<string, string[]> = {}
  const allergies = tidyItems(fields.allergies)
  const conditions = tidyItems(fields.conditions)
  const note = fields.emergencyNote?.trim() ?? ''
  for (const [key, items, noun] of [
    ['allergies', allergies, 'allergies'],
    ['conditions', conditions, 'conditions'],
  ] as const) {
    if (items.length > HEALTH_CARD_ITEMS_MAX) fieldErrors[key] = [`Keep it to ${String(HEALTH_CARD_ITEMS_MAX)} ${noun}.`]
    else if (items.some(item => item.length > HEALTH_CARD_ITEM_MAX_LENGTH)) fieldErrors[key] = ['Keep each one short.']
  }
  if (fields.bloodType !== null && !(BLOOD_TYPES as readonly string[]).includes(fields.bloodType)) {
    fieldErrors.bloodType = ['Pick a blood type from the list.']
  }
  if (note.length > HEALTH_CARD_NOTE_MAX_LENGTH) fieldErrors.emergencyNote = ['That note is too long.']
  const [first] = Object.values(fieldErrors)
  if (first?.[0] !== undefined) throw new ValidationError(first[0], { details: { fieldErrors } })
  return { ...fields, allergies, conditions, emergencyNote: note === '' ? null : note }
}

/** Whether there's anything on the card worth showing someone. Current medicines count too. */
export function hasHealthCardDetails(card: HealthCardFields & { readonly medicines: readonly unknown[] }): boolean {
  return (
    card.bloodType !== null ||
    card.allergies.length > 0 ||
    card.conditions.length > 0 ||
    card.doctorContactId !== null ||
    card.insuranceDocumentId !== null ||
    card.emergencyNote !== null ||
    card.medicines.length > 0
  )
}
