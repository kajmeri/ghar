import { can, type HouseholdRole } from './auth'
import { addCalendarMonths, formatCalendarDate, isCalendarDate, monthsBetween, type CalendarDate } from './dates'
import { ValidationError } from './errors'
import { memberLabel } from './household'
import { tripPhase, type TripDates } from './trips'

// The household's people. Everyone with an account is one, and so is anyone without an account
// who things belong to: a child with a passport, a grandparent on the trip. Documents, renewals and
// trips point at people, not accounts, so a child's passport has somewhere to belong.

export const PERSON_NAME_MAX_LENGTH = 100

/** A name somebody typed for a person without an account. It can't be blank: it's all there is. */
export function normalizePersonName(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') throw new ValidationError('Give them a name.', { details: { fieldErrors: { name: ['Give them a name.'] } } })
  if (trimmed.length > PERSON_NAME_MAX_LENGTH) {
    throw new ValidationError('That name is too long.', { details: { fieldErrors: { name: ['That name is too long.'] } } })
  }
  return trimmed
}

// ---------------------------------------------------------------------------------------------
// Birth dates

/** Nobody in a household was born before this, so an earlier date is a typo. */
export const EARLIEST_BIRTH_DATE: CalendarDate = '1900-01-01'

function birthDateError(message: string): ValidationError {
  return new ValidationError(message, { details: { fieldErrors: { birthDate: [message] } } })
}

/**
 * A birth date somebody typed, or null to clear it. It's optional: without one, nothing that
 * depends on age is suggested for them. It can't be in the future, since a baby who isn't born yet
 * has nothing to pack.
 */
export function normalizeBirthDate(value: string | null, today: CalendarDate): CalendarDate | null {
  if (value === null) return null
  const date = value.trim()
  if (date === '') return null
  if (!isCalendarDate(date)) throw birthDateError('Enter a real date.')
  if (date > today) throw birthDateError('A birth date can’t be in the future.')
  if (date < EARLIEST_BIRTH_DATE) throw birthDateError('Check the year.')
  return date
}

/** Owners and adults set anyone's birth date; a member sets their own. */
export function canSetBirthDate(actor: { userId: string; role: HouseholdRole }, personUserId: string | null): boolean {
  return can(actor.role, 'people.manage') || (personUserId !== null && personUserId === actor.userId)
}

/**
 * Whole months old on a day. Someone born on the 31st is a month older on the last day of a shorter
 * month, and someone born on Feb 29 a year older on Feb 28, the way addCalendarMonths steps.
 */
export function ageInMonthsOn(birthDate: CalendarDate, on: CalendarDate): number {
  return Math.max(0, monthsBetween(birthDate, on))
}

/** Whole years old on a day. Pass the trip's first day to know how old a child will be on it. */
export function ageOn(birthDate: CalendarDate, on: CalendarDate): number {
  return Math.floor(ageInMonthsOn(birthDate, on) / 12)
}

/** "Under a month old", "18 months old", "4 years old". Months until two, the way people give a baby's age. */
export function ageLabel(birthDate: CalendarDate, on: CalendarDate): string {
  const months = ageInMonthsOn(birthDate, on)
  if (months === 0) return 'Under a month old'
  if (months < 24) return months === 1 ? '1 month old' : `${String(months)} months old`
  const years = Math.floor(months / 12)
  return `${String(years)} years old`
}

/** The fields naming a person needs. */
export interface PersonLike {
  readonly id: string
  /** Null for someone without an account. */
  readonly userId: string | null
  /** Their own name, or their account's. Null for a member who hasn't set one. */
  readonly name: string | null
}

/** What to call a person in a list: "You", their name, or for an unnamed member, what memberLabel says. */
export function personLabel(person: PersonLike, currentUserId: string): string {
  if (person.userId !== null) return memberLabel({ userId: person.userId, displayName: person.name }, currentUserId)
  return person.name?.trim() || 'Unnamed'
}

/** You first, then by name, and the unnamed last. */
export function comparePeople(currentUserId: string): (a: PersonLike, b: PersonLike) => number {
  return (a, b) => {
    const mine = (person: PersonLike) => person.userId === currentUserId
    if (mine(a) !== mine(b)) return mine(a) ? -1 : 1
    const left = a.name?.trim() ?? ''
    const right = b.name?.trim() ?? ''
    if ((left === '') !== (right === '')) return left === '' ? 1 : -1
    return left === right ? a.id.localeCompare(b.id) : left.localeCompare(right)
  }
}

// ---------------------------------------------------------------------------------------------
// Passports for a trip abroad

/** Many countries turn a traveller away with less than this left on their passport. */
export const PASSPORT_VALIDITY_MONTHS = 6

export type TripDocumentIssueKind =
  /** Nothing of kind passport belongs to them. */
  | 'no_passport'
  /** Their passport has no expiry date, so there's nothing to check. */
  | 'no_expiry_date'
  /** It runs out before they're home, or already has. */
  | 'expires_before_return'
  /** It lasts the trip, but with under six months left. */
  | 'under_six_months'

export interface TripDocumentIssue {
  personId: string
  kind: TripDocumentIssueKind
  /** The passport it's about. Null when there isn't one. */
  documentId: string | null
  expiresOn: CalendarDate | null
}

export interface TripForPassports extends TripDates {
  international: boolean
}

export interface PassportOnFile {
  id: string
  personId: string
  expiresOn: CalendarDate | null
}

/** Unknown expiry sorts after any date: we can't say it runs out, so it's the one to point at. */
function laterPassport(a: PassportOnFile, b: PassportOnFile): PassportOnFile {
  if (a.expiresOn === null) return a
  if (b.expiresOn === null) return b
  return b.expiresOn > a.expiresOn ? b : a
}

/**
 * What's wrong with the travellers' passports for a trip abroad, in traveller order. Each traveller
 * is judged on the passport of theirs that runs out last, so an old one kept next to its
 * replacement doesn't count against them. A trip at home, or one already over, has nothing to
 * check; an undated trip can only say someone has no passport.
 *
 * Only pass the passports the caller may see. Someone who can't see sensitive documents would be
 * told a traveller has none when they do, so callers without that permission shouldn't ask.
 */
export function tripDocumentIssues(
  trip: TripForPassports,
  travellerIds: readonly string[],
  passports: readonly PassportOnFile[],
  today: CalendarDate
): TripDocumentIssue[] {
  if (!trip.international || tripPhase(trip, today) === 'past') return []
  const best = new Map<string, PassportOnFile>()
  for (const passport of passports) {
    const current = best.get(passport.personId)
    best.set(passport.personId, current ? laterPassport(current, passport) : passport)
  }

  const issues: TripDocumentIssue[] = []
  for (const personId of new Set(travellerIds)) {
    const passport = best.get(personId)
    if (!passport) {
      issues.push({ personId, kind: 'no_passport', documentId: null, expiresOn: null })
      continue
    }
    const issue = { personId, documentId: passport.id, expiresOn: passport.expiresOn }
    if (passport.expiresOn === null) issues.push({ ...issue, kind: 'no_expiry_date' })
    else if (trip.endsOn === null) continue
    else if (passport.expiresOn <= trip.endsOn) issues.push({ ...issue, kind: 'expires_before_return' })
    else if (passport.expiresOn < addCalendarMonths(trip.endsOn, PASSPORT_VALIDITY_MONTHS))
      issues.push({ ...issue, kind: 'under_six_months' })
  }
  return issues
}

/** Whether an issue stops someone travelling, or is only worth checking. */
export function tripDocumentIssueTone(kind: TripDocumentIssueKind): 'negative' | 'caution' {
  return kind === 'no_passport' || kind === 'expires_before_return' ? 'negative' : 'caution'
}

/** "No passport on file", "Expires Mar 3, 2027, before the trip ends", "Expired Sep 5, 2026". */
export function tripDocumentIssuePhrase(issue: Pick<TripDocumentIssue, 'kind' | 'expiresOn'>, today: CalendarDate): string {
  const on = issue.expiresOn === null ? null : formatCalendarDate(issue.expiresOn)
  switch (issue.kind) {
    case 'no_passport':
      return 'No passport on file'
    case 'no_expiry_date':
      return 'Add its expiry date to check it'
    case 'expires_before_return':
      return issue.expiresOn !== null && issue.expiresOn < today ? `Expired ${on ?? ''}` : `Expires ${on ?? ''}, before the trip ends`
    case 'under_six_months':
      return `Expires ${on ?? ''}, under 6 months after the trip. Some countries won't allow that.`
  }
}
