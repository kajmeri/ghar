import { addCalendarDays, startOfDayInTimeZone, toCalendarDate, wallClockTimeInTimeZone, type CalendarDate, type TimeZone } from './dates'
import { ValidationError } from './errors'
import type { Cents } from './money'
import { bookingTitle, carrierName } from './travel/bookings'
import type { BookingFields, BookingKind } from './travel/types'
import { tripDays, type TripDates } from './trips'

// A trip's plan is a grid of slots: a day, a part of the day, and what the slot is for ("Dinner").
// A slot holds the options the household is choosing between. None is an open question, one
// chosen is a decision, several candidates is a debate. Times are optional because early
// planning happens in parts of the day, not on the clock.

/** Parts of the day, in the order they happen. */
export const SLOT_BANDS = ['early', 'morning', 'midday', 'afternoon', 'evening', 'night'] as const
export type SlotBand = (typeof SLOT_BANDS)[number]

export const SLOT_KINDS = ['meal', 'activity', 'transport', 'lodging', 'downtime', 'note'] as const
export type SlotKind = (typeof SLOT_KINDS)[number]

export const SLOT_STATUSES = ['open', 'decided', 'booked', 'skipped'] as const
export type SlotStatus = (typeof SLOT_STATUSES)[number]

export const OPTION_STATUSES = ['candidate', 'chosen', 'rejected'] as const
export type OptionStatus = (typeof OPTION_STATUSES)[number]

export const COST_BASES = ['per_person', 'total'] as const
export type CostBasis = (typeof COST_BASES)[number]

export const OPTION_SOURCES = ['manual', 'link', 'idea_board', 'booking'] as const
export type OptionSource = (typeof OPTION_SOURCES)[number]

export const OPTION_VOTES = ['yes', 'maybe', 'no'] as const
export type OptionVote = (typeof OPTION_VOTES)[number]

/**
 * Positions are spaced so a future insert between two slots has room without renumbering.
 * Moving renumbers the whole cell anyway, because a cell holds a handful of slots.
 */
export const SORT_ORDER_STEP = 1000

export const SLOT_BAND_LABELS: Record<SlotBand, string> = {
  early: 'Early',
  morning: 'Morning',
  midday: 'Midday',
  afternoon: 'Afternoon',
  evening: 'Evening',
  night: 'Night',
}

export const SLOT_KIND_LABELS: Record<SlotKind, string> = {
  meal: 'Meal',
  activity: 'Activity',
  transport: 'Getting around',
  lodging: 'Stay',
  downtime: 'Downtime',
  note: 'Note',
}

/**
 * Where each band sits on the clock, as [start, end) in minutes after midnight. `typical` is the
 * time a slot with no clock time is assumed to happen, for travel and opening-hours checks.
 */
export const SLOT_BAND_WINDOWS: Record<SlotBand, { start: number; end: number; typical: number }> = {
  early: { start: 0, end: 7 * 60, typical: 6 * 60 },
  morning: { start: 7 * 60, end: 11 * 60, typical: 9 * 60 },
  midday: { start: 11 * 60, end: 14 * 60, typical: 12 * 60 + 30 },
  afternoon: { start: 14 * 60, end: 17 * 60, typical: 15 * 60 },
  evening: { start: 17 * 60, end: 21 * 60, typical: 19 * 60 },
  night: { start: 21 * 60, end: 24 * 60, typical: 22 * 60 },
}

const HH_MM = /^(\d{2}):(\d{2})$/

/** Minutes after midnight for "HH:MM". Throws on anything else. */
export function minutesOfDay(time: string): number {
  const parts = HH_MM.exec(time)
  const hour = Number(parts?.[1])
  const minute = Number(parts?.[2])
  if (!parts || hour > 23 || minute > 59) {
    throw new ValidationError(`"${time}" is not a time of day (HH:MM)`, { details: { time } })
  }
  return hour * 60 + minute
}

/** The band a wall-clock time falls in. */
export function bandForTime(time: string): SlotBand {
  const minutes = minutesOfDay(time)
  return SLOT_BANDS.find(band => minutes < SLOT_BAND_WINDOWS[band].end) ?? 'night'
}

/** The band an instant falls in, read in the household's zone. */
export function bandForInstant(instant: Date, timeZone: TimeZone): SlotBand {
  return bandForTime(wallClockTimeInTimeZone(instant, timeZone))
}

export function compareBands(a: SlotBand, b: SlotBand): number {
  return SLOT_BANDS.indexOf(a) - SLOT_BANDS.indexOf(b)
}

// Ordering and grouping

/** The fields ordering and grouping need. Callers pass their own richer rows through. */
export interface SlotPosition {
  readonly id: string
  readonly day: CalendarDate
  readonly band: SlotBand
  readonly startsAt: Date | null
  readonly sortOrder: number
}

/** One row's new position, ready to write back. */
export interface PositionChange {
  readonly id: string
  readonly sortOrder: number
}

export interface SlotDay<T> {
  readonly day: CalendarDate
  readonly slots: readonly T[]
}

/**
 * Within a day the band comes first, then `sortOrder`, which is what moving sets. Times only
 * break ties, so giving a slot a time later does not jump the order someone chose.
 */
export function compareSlots(a: SlotPosition, b: SlotPosition): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1
  const band = compareBands(a.band, b.band)
  if (band !== 0) return band
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  const aTime = a.startsAt?.getTime() ?? Number.POSITIVE_INFINITY
  const bTime = b.startsAt?.getTime() ?? Number.POSITIVE_INFINITY
  if (aTime !== bTime) return aTime - bTime
  return a.id.localeCompare(b.id)
}

/**
 * The timeline: every day of the trip, in order, each with its slots. Empty days are kept,
 * because an empty day is information. Slots sitting outside the trip's dates get their own day
 * rather than disappearing, which is what you want after someone shortens a trip.
 */
export function groupSlotsByDay<T extends SlotPosition>(slots: readonly T[], dates: TripDates): SlotDay<T>[] {
  const byDay = new Map<CalendarDate, T[]>()
  for (const day of tripDays(dates)) byDay.set(day, [])
  for (const slot of slots) {
    const existing = byDay.get(slot.day)
    if (existing) existing.push(slot)
    else byDay.set(slot.day, [slot])
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, daySlots]) => ({ day, slots: [...daySlots].sort(compareSlots) }))
}

/** The slots in one cell of the week grid, in order. */
export function slotsInCell<T extends SlotPosition>(slots: readonly T[], day: CalendarDate, band: SlotBand): T[] {
  return slots.filter(slot => slot.day === day && slot.band === band).sort(compareSlots)
}

/**
 * Where a new slot lands in its cell. A timed slot goes among the timed slots it belongs
 * between so it reads in time order straight away; an untimed one goes to the end.
 */
export function sortOrderForInsert(cellSlots: readonly SlotPosition[], startsAt: Date | null): number {
  const ordered = [...cellSlots].sort(compareSlots)
  const last = ordered.at(-1)
  const end = (last?.sortOrder ?? 0) + SORT_ORDER_STEP
  if (startsAt === null) return end

  const time = startsAt.getTime()
  const beforeIndex = ordered.findIndex(slot => slot.startsAt !== null && slot.startsAt.getTime() > time)
  const after = ordered[beforeIndex]
  if (beforeIndex === -1 || !after) return end

  const before = beforeIndex === 0 ? undefined : ordered[beforeIndex - 1]
  const low = before?.sortOrder ?? after.sortOrder - SORT_ORDER_STEP * 2
  const midpoint = Math.floor((low + after.sortOrder) / 2)
  // No room left between neighbours. Ties are legal: compareSlots breaks them on time.
  return midpoint === low || midpoint === after.sortOrder ? after.sortOrder : midpoint
}

/** Evenly spaced positions, in the order given. Only changed rows come back. */
export function resequence(ordered: readonly SlotPosition[]): PositionChange[] {
  const changes: PositionChange[] = []
  ordered.forEach((slot, index) => {
    const sortOrder = (index + 1) * SORT_ORDER_STEP
    if (slot.sortOrder !== sortOrder) changes.push({ id: slot.id, sortOrder })
  })
  return changes
}

export interface SlotMove {
  readonly day: CalendarDate
  readonly band: SlotBand
  /** Position within the target cell, counted after the slot is lifted out. Omit for the end. */
  readonly toIndex?: number
}

/**
 * Dragging on the week grid and "Move to" on a phone are the same edit: put this slot in that
 * cell. Returns the new positions for every slot in the target cell whose position changed, the
 * moved slot included. Out-of-range indexes clamp, because a drop at the edge is a normal gesture.
 */
export function planSlotMove(slots: readonly SlotPosition[], slotId: string, move: SlotMove): PositionChange[] {
  const moved = slots.find(slot => slot.id === slotId)
  if (!moved) throw new ValidationError('That slot is not on this trip', { details: { slotId } })
  if (move.toIndex !== undefined && !Number.isInteger(move.toIndex)) {
    throw new ValidationError('toIndex must be a whole number', { details: { toIndex: move.toIndex } })
  }

  const cell = slotsInCell(
    slots.filter(slot => slot.id !== slotId),
    move.day,
    move.band
  )
  const index = move.toIndex === undefined ? cell.length : Math.min(Math.max(move.toIndex, 0), cell.length)
  const placed = { ...moved, day: move.day, band: move.band }
  const ordered: SlotPosition[] = [...cell.slice(0, index), placed, ...cell.slice(index)]

  const changes = resequence(ordered)
  const cellChanged = moved.day !== move.day || moved.band !== move.band
  // A slot that changed cell must be written even when its number happens to fit.
  if (cellChanged && !changes.some(change => change.id === slotId)) {
    changes.push({ id: slotId, sortOrder: (index + 1) * SORT_ORDER_STEP })
  }
  return changes.sort((a, b) => a.sortOrder - b.sortOrder)
}

// Options and choosing

/** What choosing, rejecting and costing need to know about an option. */
export interface OptionState {
  readonly id: string
  readonly status: OptionStatus
  readonly sortOrder: number
  readonly bookingId: string | null
}

export interface SlotState {
  readonly status: SlotStatus
  readonly chosenOptionId: string | null
}

export interface ChoicePlan {
  readonly slot: SlotState
  /** Options whose status changes. */
  readonly options: readonly { id: string; status: OptionStatus }[]
}

function requireOption<T extends OptionState>(options: readonly T[], optionId: string): T {
  const option = options.find(each => each.id === optionId)
  if (!option) throw new ValidationError('That option is not in this slot', { details: { optionId } })
  return option
}

/**
 * Choosing an option decides the slot. Whatever was chosen before goes back to being a
 * candidate, not rejected: changing your mind is not the same as ruling something out. Choosing
 * a rejected option brings it back. A slot whose choice came from a booking is booked.
 */
export function planChoice(options: readonly OptionState[], optionId: string): ChoicePlan {
  const option = requireOption(options, optionId)
  const changes: { id: string; status: OptionStatus }[] = []
  for (const each of options) {
    if (each.id === optionId && each.status !== 'chosen') changes.push({ id: each.id, status: 'chosen' })
    if (each.id !== optionId && each.status === 'chosen') changes.push({ id: each.id, status: 'candidate' })
  }
  return {
    slot: { status: option.bookingId ? 'booked' : 'decided', chosenOptionId: optionId },
    options: changes,
  }
}

/**
 * Rejecting keeps the option, greyed and out of the way, so nobody re-researches a place the
 * household already ruled out. Rejecting the chosen option reopens the slot.
 */
export function planRejection(options: readonly OptionState[], slot: SlotState, optionId: string): ChoicePlan {
  const option = requireOption(options, optionId)
  const wasChosen = slot.chosenOptionId === optionId || option.status === 'chosen'
  return {
    slot: wasChosen ? { status: slot.status === 'skipped' ? 'skipped' : 'open', chosenOptionId: null } : slot,
    options: option.status === 'rejected' ? [] : [{ id: optionId, status: 'rejected' }],
  }
}

/** Takes a rejection back. The option is a candidate again; nothing is chosen for you. */
export function planRestore(options: readonly OptionState[], slot: SlotState, optionId: string): ChoicePlan {
  const option = requireOption(options, optionId)
  return { slot, options: option.status === 'rejected' ? [{ id: optionId, status: 'candidate' }] : [] }
}

/** Undo a decision: the chosen option goes back into the running and the slot is open again. */
export function planReopen(options: readonly OptionState[]): ChoicePlan {
  return {
    slot: { status: 'open', chosenOptionId: null },
    options: options.filter(option => option.status === 'chosen').map(option => ({ id: option.id, status: 'candidate' as const })),
  }
}

/** Skipping a slot says "we're not doing this". Any choice goes back to being a candidate. */
export function planSkip(options: readonly OptionState[]): ChoicePlan {
  return { ...planReopen(options), slot: { status: 'skipped', chosenOptionId: null } }
}

/** Candidates and the chosen option in their order, and the rejected ones set aside. */
export function partitionOptions<T extends OptionState>(options: readonly T[]): { active: T[]; rejected: T[] } {
  const ordered = [...options].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
  return {
    active: ordered.filter(option => option.status !== 'rejected'),
    rejected: ordered.filter(option => option.status === 'rejected'),
  }
}

export type SlotShape = 'decided' | 'debating' | 'empty' | 'skipped'

/**
 * How a slot reads on the timeline. Decided is one line; debating is one line with a count of
 * options; empty is a dashed invitation to add one; skipped stays visible but quiet.
 */
export function slotShape(slot: SlotState & { readonly options: readonly OptionState[] }): SlotShape {
  if (slot.status === 'skipped') return 'skipped'
  if ((slot.status === 'decided' || slot.status === 'booked') && slot.options.some(option => option.id === slot.chosenOptionId)) {
    return 'decided'
  }
  return slot.options.some(option => option.status !== 'rejected') ? 'debating' : 'empty'
}

export function isOpenDecision(slot: SlotState): boolean {
  return slot.status === 'open'
}

export function chosenOptionOf<T extends { readonly id: string }>(slot: SlotState & { readonly options: readonly T[] }): T | null {
  if (slot.status !== 'decided' && slot.status !== 'booked') return null
  return slot.options.find(option => option.id === slot.chosenOptionId) ?? null
}

// Money

export interface OptionCost {
  readonly costCents: Cents | null
  readonly costBasis: CostBasis
}

/** What an option costs the whole party. Per-person prices multiply by how many are going. */
export function optionTotalCents(option: OptionCost, travelers: number): Cents | null {
  if (option.costCents === null) return null
  const total = option.costBasis === 'per_person' ? option.costCents * Math.max(1, Math.floor(travelers)) : option.costCents
  if (!Number.isSafeInteger(total)) {
    throw new ValidationError('That cost is outside the safe integer range')
  }
  return total
}

/** The planned cost of a set of slots: what their chosen options cost. Undecided slots add nothing. */
export function plannedCents(
  slots: readonly (SlotState & { readonly options: readonly (OptionCost & { readonly id: string })[] })[],
  travelers: number
): Cents {
  let total = 0
  for (const slot of slots) {
    const chosen = chosenOptionOf(slot)
    total += chosen ? (optionTotalCents(chosen, travelers) ?? 0) : 0
  }
  if (!Number.isSafeInteger(total)) {
    throw new ValidationError('Planned cost is outside the safe integer range')
  }
  return total
}

// Votes

export interface OptionVoteRow {
  readonly userId: string
  readonly vote: OptionVote
}

export interface OptionVoteTally {
  readonly yes: number
  readonly maybe: number
  readonly no: number
  /** Yes minus no. Maybe is a shrug and moves nothing. */
  readonly score: number
  readonly voters: number
}

export function tallyOptionVotes(votes: readonly OptionVoteRow[]): OptionVoteTally {
  let yes = 0
  let maybe = 0
  let no = 0
  for (const { vote } of votes) {
    if (vote === 'yes') yes += 1
    else if (vote === 'maybe') maybe += 1
    else no += 1
  }
  return { yes, maybe, no, score: yes - no, voters: yes + maybe + no }
}

export function optionVoteOf(votes: readonly OptionVoteRow[], userId: string): OptionVote | null {
  return votes.find(vote => vote.userId === userId)?.vote ?? null
}

/**
 * The vote to store when someone taps a vote button. Tapping the vote you already cast takes it
 * back, so one button is both vote and un-vote. Null means delete the row.
 */
export function nextOptionVote(current: OptionVote | null, tapped: OptionVote): OptionVote | null {
  return current === tapped ? null : tapped
}

/** The option the votes favour, if one clearly leads. Ties have no leader. */
export function leadingOptionId(options: readonly (OptionState & { readonly votes: readonly OptionVoteRow[] })[]): string | null {
  const scored = options
    .filter(option => option.status !== 'rejected')
    .map(option => ({ id: option.id, tally: tallyOptionVotes(option.votes) }))
    .filter(each => each.tally.voters > 0)
    .sort((a, b) => b.tally.score - a.tally.score)
  const [first, second] = scored
  if (!first || first.tally.score <= 0) return null
  return second && second.tally.score === first.tally.score ? null : first.id
}

// Deadlines and the decisions queue

export const DEADLINE_SOON_HOURS = 48

export type DeadlineState = 'passed' | 'soon' | 'later'

/**
 * A deadline is a calendar date, and it lasts until that day ends in the household's zone.
 * "Reserve by Friday" still means Friday evening.
 */
export function deadlineState(deadline: CalendarDate, timeZone: TimeZone, now: Date): DeadlineState {
  const endsAt = startOfDayInTimeZone(addCalendarDays(deadline, 1), timeZone).getTime()
  const left = endsAt - now.getTime()
  if (left <= 0) return 'passed'
  return left <= DEADLINE_SOON_HOURS * 3_600_000 ? 'soon' : 'later'
}

export interface DecisionCandidate extends SlotPosition, SlotState {
  readonly decideBy: CalendarDate | null
  readonly options: readonly (OptionState & { readonly bookingRequired: boolean; readonly bookingDeadline: CalendarDate | null })[]
}

/**
 * The date a slot has to be settled by: its own decide-by, or the earliest reservation deadline
 * among the options still in the running, whichever comes first.
 */
export function decisionDeadline(slot: DecisionCandidate): CalendarDate | null {
  const dates = [slot.decideBy]
  for (const option of slot.options) {
    if (option.status !== 'rejected' && option.bookingRequired) dates.push(option.bookingDeadline)
  }
  const present = dates.filter((date): date is CalendarDate => date !== null).sort()
  return present[0] ?? null
}

/**
 * The decisions queue, most urgent first. Anything with a deadline comes before anything
 * without, soonest deadline first; after that, the slot happening soonest. Only open slots are
 * decisions.
 */
export function decisionQueue<T extends DecisionCandidate>(slots: readonly T[]): T[] {
  return slots
    .filter(isOpenDecision)
    .map(slot => ({ slot, deadline: decisionDeadline(slot) }))
    .sort((a, b) => {
      if (a.deadline !== b.deadline) {
        if (a.deadline === null) return 1
        if (b.deadline === null) return -1
        return a.deadline < b.deadline ? -1 : 1
      }
      return compareSlots(a.slot, b.slot)
    })
    .map(each => each.slot)
}

// Scaffolding

export interface SlotDraft {
  readonly day: CalendarDate
  readonly band: SlotBand
  readonly kind: SlotKind
  readonly label: string
  readonly sortOrder: number
}

/** The skeleton a day is offered: three meals and three blocks of time around them. */
export const DAY_SKELETON: readonly { band: SlotBand; kind: SlotKind; label: string }[] = [
  { band: 'morning', kind: 'meal', label: 'Breakfast' },
  { band: 'morning', kind: 'activity', label: 'Morning' },
  { band: 'midday', kind: 'meal', label: 'Lunch' },
  { band: 'afternoon', kind: 'activity', label: 'Afternoon' },
  { band: 'evening', kind: 'meal', label: 'Dinner' },
  { band: 'evening', kind: 'activity', label: 'Evening' },
]

/**
 * The skeleton for one day, minus anything the day already has under the same name in the same
 * band, so accepting the offer twice, or after adding dinner by hand, never doubles up.
 */
export function skeletonDrafts(day: CalendarDate, existing: readonly (SlotPosition & { readonly label: string })[]): SlotDraft[] {
  const onDay = existing.filter(slot => slot.day === day)
  const nextByBand = new Map<SlotBand, number>()
  for (const slot of onDay) nextByBand.set(slot.band, Math.max(nextByBand.get(slot.band) ?? 0, slot.sortOrder))

  const drafts: SlotDraft[] = []
  for (const part of DAY_SKELETON) {
    const taken = onDay.some(slot => slot.band === part.band && slot.label.trim().toLowerCase() === part.label.toLowerCase())
    if (taken) continue
    const sortOrder = (nextByBand.get(part.band) ?? 0) + SORT_ORDER_STEP
    nextByBand.set(part.band, sortOrder)
    drafts.push({ day, ...part, sortOrder })
  }
  return drafts
}

/** Trip days that have nothing planned and whose skeleton offer nobody has dismissed. */
export function daysOfferingSkeleton(dates: TripDates, slots: readonly { readonly day: CalendarDate }[], dismissed: readonly CalendarDate[]): CalendarDate[] {
  const planned = new Set(slots.map(slot => slot.day))
  const skipped = new Set(dismissed)
  return tripDays(dates).filter(day => !planned.has(day) && !skipped.has(day))
}

// Bookings

/** What a booking looks like to this module. A subset of a booking from @ghar/core/travel. */
export type BookingLike = Pick<
  BookingFields,
  'kind' | 'confirmationCode' | 'providerName' | 'carrier' | 'origin' | 'destination' | 'propertyName' | 'checkIn' | 'departAt' | 'paidCents'
> & { readonly id: string }

/** A slot with its one chosen option, generated from a booking and not yet written. */
export interface BookingSlotDraft {
  readonly bookingId: string
  readonly day: CalendarDate
  readonly band: SlotBand
  readonly kind: SlotKind
  readonly label: string
  readonly startsAt: Date | null
  readonly option: {
    readonly title: string
    readonly subtitle: string | null
    readonly confirmationCode: string | null
    readonly costCents: Cents
    readonly costBasis: CostBasis
  }
}

const BOOKING_SLOT: Record<BookingKind, { kind: SlotKind; label: string; band: SlotBand }> = {
  flight: { kind: 'transport', label: 'Flight', band: 'morning' },
  hotel: { kind: 'lodging', label: 'Check in', band: 'evening' },
  car: { kind: 'transport', label: 'Car pick-up', band: 'morning' },
}

/**
 * The slot a booking gets, already decided. A flight becomes "TAP Air Portugal: EWR to LIS" at
 * its departure; a stay is one slot on check-in day; a car sits on its pick-up day.
 *
 * Returns null when there is no day to put it on: a booking without dates on a trip without
 * dates has nowhere to go, and inventing a day would be worse than leaving it linked but unlisted.
 */
export function slotDraftFromBooking(
  booking: BookingLike,
  options: { timeZone: TimeZone; fallbackDay?: CalendarDate | null }
): BookingSlotDraft | null {
  const day = (booking.departAt ? toCalendarDate(booking.departAt, options.timeZone) : booking.checkIn) ?? options.fallbackDay ?? null
  if (day === null) return null
  const shape = BOOKING_SLOT[booking.kind]

  return {
    bookingId: booking.id,
    day,
    band: booking.departAt ? bandForInstant(booking.departAt, options.timeZone) : shape.band,
    kind: shape.kind,
    label: shape.label,
    startsAt: booking.departAt,
    option: {
      title: bookingOptionTitle(booking),
      subtitle: booking.kind === 'car' ? booking.origin : booking.destination,
      confirmationCode: booking.confirmationCode,
      costCents: booking.paidCents,
      costBasis: 'total',
    },
  }
}

function bookingOptionTitle(booking: BookingLike): string {
  const title = bookingTitle(booking)
  if (booking.kind !== 'flight') return title
  const airline = carrierName(booking.carrier)
  return airline ? `${airline}: ${title}` : title
}

// Travel mode

/**
 * What travel mode needs: today, what is under way, and the thing happening next. Only decided
 * slots make it onto a travel day; an undecided dinner is not a plan.
 */
export interface DayPlan<T> {
  readonly day: CalendarDate
  readonly slots: readonly T[]
  /** Under way right now, by its own start and end. Empty when nothing is. */
  readonly current: readonly T[]
  /** The next thing that starts today, if anything does. */
  readonly next: T | null
}

export function dayPlan<T extends SlotPosition & { readonly endsAt: Date | null }>(slots: readonly T[], day: CalendarDate, now: Date): DayPlan<T> {
  const today = slots.filter(slot => slot.day === day).sort(compareSlots)
  const time = now.getTime()

  const current = today.filter(slot => slot.startsAt !== null && slot.startsAt.getTime() <= time && slot.endsAt !== null && slot.endsAt.getTime() >= time)
  const next = today.find(slot => slot.startsAt !== null && slot.startsAt.getTime() > time) ?? null

  return { day, slots: today, current, next }
}
