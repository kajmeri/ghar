import { formatCalendarDate, wallClockTimeInTimeZone, type CalendarDate, type TimeZone } from '../dates'
import {
  SLOT_BAND_WINDOWS,
  chosenOptionOf,
  compareSlots,
  deadlineState,
  decisionDeadline,
  minutesOfDay,
  type DeadlineState,
  type DecisionCandidate,
  type OptionState,
  type SlotPosition,
  type SlotState,
} from '../itinerary'

// Whether a plan can actually happen: getting from one place to the next in time, arriving
// somewhere that is open, and booking before the booking window shuts. Everything here is an
// estimate that informs a quiet warning, never a rule that blocks a choice.

export const TRAVEL_MODES = ['walk', 'transit', 'drive'] as const
export type TravelMode = (typeof TRAVEL_MODES)[number]

export interface Coordinates {
  readonly lat: number
  readonly lng: number
}

/**
 * Straight-line distance is shorter than any street route, so each mode stretches it by a detour
 * factor, moves at a typical city speed, and pays a fixed overhead: finding the platform, parking.
 */
export const TRAVEL_MODE_PROFILES: Record<TravelMode, { kmh: number; detour: number; overheadMinutes: number }> = {
  walk: { kmh: 4.5, detour: 1.3, overheadMinutes: 0 },
  transit: { kmh: 18, detour: 1.4, overheadMinutes: 8 },
  drive: { kmh: 28, detour: 1.35, overheadMinutes: 5 },
}

/** Farther than this in a straight line and the estimate assumes you ride. */
export const WALKING_LIMIT_METERS = 1500

const EARTH_RADIUS_METERS = 6_371_000

export function haversineMeters(from: Coordinates, to: Coordinates): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = rad(to.lat - from.lat)
  const dLng = rad(to.lng - from.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)))
}

export interface TravelEstimate {
  /** Along the way, not as the crow flies. */
  readonly meters: number
  readonly minutes: number
  readonly mode: TravelMode
  /** `estimate` from distance alone; `routed` when a routing provider worked it out. */
  readonly source: 'estimate' | 'routed'
}

export function suggestTravelMode(straightMeters: number): TravelMode {
  return straightMeters <= WALKING_LIMIT_METERS ? 'walk' : 'transit'
}

/** Next door is zero minutes, not the overhead of a mode nobody would take. */
const SAME_PLACE_METERS = 50

export function estimateTravel(from: Coordinates, to: Coordinates, mode?: TravelMode): TravelEstimate {
  const straight = haversineMeters(from, to)
  const chosen = mode ?? suggestTravelMode(straight)
  const profile = TRAVEL_MODE_PROFILES[chosen]
  const meters = Math.round(straight * profile.detour)
  const minutes = straight < SAME_PLACE_METERS ? 0 : Math.ceil((meters / 1000 / profile.kmh) * 60 + profile.overheadMinutes)
  return { meters, minutes, mode: chosen, source: 'estimate' }
}

// The plan, as far as feasibility is concerned

export interface FeasibilityOption extends OptionState {
  readonly title: string
  readonly lat: number | null
  readonly lng: number | null
  readonly durationMinutes: number | null
  /** "HH:MM", local to the place. */
  readonly opensAt: string | null
  readonly closesAt: string | null
  /** Days of the week it is shut, 0 for Sunday. */
  readonly closedDays: readonly number[]
  readonly bookingRequired: boolean
  readonly bookingDeadline: CalendarDate | null
}

export interface FeasibilitySlot extends SlotPosition, SlotState, DecisionCandidate {
  readonly endsAt: Date | null
  readonly options: readonly FeasibilityOption[]
}

function coordinatesOf(option: FeasibilityOption): Coordinates | null {
  return option.lat === null || option.lng === null ? null : { lat: option.lat, lng: option.lng }
}

export interface TravelLeg {
  readonly key: string
  readonly fromOptionId: string
  readonly toOptionId: string
  readonly from: Coordinates
  readonly to: Coordinates
}

export function legKey(fromOptionId: string, toOptionId: string): string {
  return `${fromOptionId}>${toOptionId}`
}

export interface Stop<S, O> {
  readonly slot: S
  readonly option: O
}

/**
 * Where you would be coming from before a slot: the nearest earlier slot that day whose chosen
 * option has a place on the map. Undecided slots in between are passed over, because you can't
 * travel from a place you haven't picked.
 */
export function previousStop<S extends FeasibilitySlot>(slots: readonly S[], slotId: string): Stop<S, S['options'][number]> | null {
  const target = slots.find(slot => slot.id === slotId)
  if (!target) return null
  const earlier = slots.filter(slot => slot.day === target.day && slot.id !== slotId && compareSlots(slot, target) < 0).sort(compareSlots)
  for (const slot of earlier.reverse()) {
    if (slot.status === 'skipped') continue
    const option = chosenOptionOf(slot)
    if (option && coordinatesOf(option)) return { slot, option }
  }
  return null
}

/**
 * Every journey worth estimating: from each slot's previous stop to each option still in the
 * running. A routing provider prices these in one batch; distance alone prices them for free.
 */
export function itineraryLegs(slots: readonly FeasibilitySlot[]): TravelLeg[] {
  const legs = new Map<string, TravelLeg>()
  for (const slot of slots) {
    if (slot.status === 'skipped') continue
    const stop = previousStop(slots, slot.id)
    const from = stop ? coordinatesOf(stop.option) : null
    if (!stop || !from) continue
    for (const option of slot.options) {
      const to = coordinatesOf(option)
      if (option.status === 'rejected' || !to) continue
      const key = legKey(stop.option.id, option.id)
      legs.set(key, { key, fromOptionId: stop.option.id, toOptionId: option.id, from, to })
    }
  }
  return [...legs.values()]
}

export type LegEstimates = ReadonlyMap<string, TravelEstimate>

/** Distance-only estimates for a batch of legs, keyed by `legKey`. */
export function estimateLegs(legs: readonly TravelLeg[], mode?: TravelMode): Map<string, TravelEstimate> {
  return new Map(legs.map(leg => [leg.key, estimateTravel(leg.from, leg.to, mode)]))
}

// Opening hours

export type HoursCheck = 'open' | 'closed_day' | 'outside_hours' | 'unknown'

const MINUTES_PER_DAY = 24 * 60

/** Day of the week for a calendar date, 0 for Sunday. No zone: a date is already local. */
export function dayOfWeek(day: CalendarDate): number {
  return new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)))).getUTCDay()
}

export interface Visit {
  readonly day: CalendarDate
  readonly band: SlotPosition['band']
  /** Minutes after midnight, when the slot has a clock time. */
  readonly startMinutes: number | null
  /** How long the visit lasts, when known. */
  readonly lengthMinutes: number | null
}

/**
 * Whether a place is open for the visit. Hours that run past midnight ("18:00" to "02:00") are
 * understood. A slot with only a band counts as covered when some stretch of that band, long
 * enough for the visit, falls inside the hours.
 */
export function checkOpeningHours(option: Pick<FeasibilityOption, 'opensAt' | 'closesAt' | 'closedDays'>, visit: Visit): HoursCheck {
  if (option.closedDays.includes(dayOfWeek(visit.day))) return 'closed_day'
  if (option.opensAt === null || option.closesAt === null) return 'unknown'

  const opens = minutesOfDay(option.opensAt)
  let closes = minutesOfDay(option.closesAt)
  if (closes <= opens) closes += MINUTES_PER_DAY
  const length = visit.lengthMinutes ?? 0

  if (visit.startMinutes !== null) {
    let start = visit.startMinutes
    // Half past midnight at a place open until two belongs to the night before's hours.
    if (start < opens && start + MINUTES_PER_DAY < closes) start += MINUTES_PER_DAY
    return start >= opens && start + length <= closes ? 'open' : 'outside_hours'
  }

  const window = SLOT_BAND_WINDOWS[visit.band]
  const earliest = Math.max(opens, window.start)
  return earliest < window.end && earliest + length <= closes ? 'open' : 'outside_hours'
}

// Arrival

export type ArrivalCheck = 'ok' | 'late' | 'unknown'

function endOf(slot: FeasibilitySlot, option: FeasibilityOption | null): Date | null {
  if (slot.endsAt) return slot.endsAt
  if (slot.startsAt && option?.durationMinutes) return new Date(slot.startsAt.getTime() + option.durationMinutes * 60_000)
  return null
}

// Putting it together

export interface OptionFacts {
  readonly optionId: string
  readonly slotId: string
  /** The journey from the previous stop, when both ends are on the map. */
  readonly travel: TravelEstimate | null
  readonly fromTitle: string | null
  /** Whether that journey fits between the previous stop ending and this slot starting. */
  readonly arrival: ArrivalCheck
  readonly gapMinutes: number | null
  readonly hours: HoursCheck
  /** The reservation deadline, for options that need one. */
  readonly deadline: { readonly date: CalendarDate; readonly state: DeadlineState } | null
}

export type ItineraryWarningKind = 'late_arrival' | 'closed' | 'deadline_passed' | 'deadline_soon'

export interface ItineraryWarning {
  readonly slotId: string
  readonly optionId: string | null
  readonly kind: ItineraryWarningKind
  readonly message: string
}

export interface ItineraryAssessment {
  readonly facts: ReadonlyMap<string, OptionFacts>
  readonly warnings: readonly ItineraryWarning[]
}

export function visitFor(slot: FeasibilitySlot, option: FeasibilityOption | null, timeZone: TimeZone): Visit {
  const startMinutes = slot.startsAt ? minutesOfDay(wallClockTimeInTimeZone(slot.startsAt, timeZone)) : null
  const fromTimes = slot.startsAt && slot.endsAt ? Math.round((slot.endsAt.getTime() - slot.startsAt.getTime()) / 60_000) : null
  return { day: slot.day, band: slot.band, startMinutes, lengthMinutes: fromTimes ?? option?.durationMinutes ?? null }
}

function factsFor(
  slots: readonly FeasibilitySlot[],
  slot: FeasibilitySlot,
  option: FeasibilityOption,
  context: { timeZone: TimeZone; now: Date; legs: LegEstimates }
): OptionFacts {
  const stop = previousStop(slots, slot.id)
  const travel = stop ? (context.legs.get(legKey(stop.option.id, option.id)) ?? null) : null

  let arrival: ArrivalCheck = 'unknown'
  let gapMinutes: number | null = null
  const previousEnd = stop ? endOf(stop.slot, stop.option) : null
  if (travel && previousEnd && slot.startsAt) {
    gapMinutes = Math.floor((slot.startsAt.getTime() - previousEnd.getTime()) / 60_000)
    arrival = travel.minutes > gapMinutes ? 'late' : 'ok'
  }

  return {
    optionId: option.id,
    slotId: slot.id,
    travel,
    fromTitle: stop?.option.title ?? null,
    arrival,
    gapMinutes,
    hours: checkOpeningHours(option, visitFor(slot, option, context.timeZone)),
    deadline:
      option.bookingRequired && option.bookingDeadline
        ? { date: option.bookingDeadline, state: deadlineState(option.bookingDeadline, context.timeZone, context.now) }
        : null,
  }
}

const shortDate = (date: CalendarDate) => formatCalendarDate(date, 'MMM d')

function lateMessage(facts: OptionFacts): string {
  const minutes = facts.travel?.minutes ?? 0
  const from = facts.fromTitle ?? 'the previous stop'
  if (facts.gapMinutes !== null && facts.gapMinutes < 0) return `Starts before ${from} ends`
  return `About ${minutes} min from ${from}, with ${facts.gapMinutes ?? 0} min to get there`
}

function hoursMessage(option: FeasibilityOption, facts: OptionFacts, day: CalendarDate): string {
  if (facts.hours === 'closed_day') return `Closed on ${formatCalendarDate(day, 'EEEE')}s`
  return `Open ${option.opensAt ?? ''}–${option.closesAt ?? ''}, which misses this time`
}

/**
 * Facts for every option on the trip, and the few warnings worth showing on the timeline. A
 * decided slot is checked on its choice. An open slot only warns about time running out on the
 * decision; the compare view shows each candidate's own facts.
 */
export function assessItinerary(
  slots: readonly FeasibilitySlot[],
  context: { timeZone: TimeZone; now: Date; legs: LegEstimates }
): ItineraryAssessment {
  const facts = new Map<string, OptionFacts>()
  const warnings: ItineraryWarning[] = []

  for (const slot of slots) {
    for (const option of slot.options) facts.set(option.id, factsFor(slots, slot, option, context))
    if (slot.status === 'skipped') continue

    const chosen = chosenOptionOf(slot)
    if (chosen) {
      const own = facts.get(chosen.id)
      if (!own) continue
      if (own.arrival === 'late') warnings.push({ slotId: slot.id, optionId: chosen.id, kind: 'late_arrival', message: lateMessage(own) })
      if (own.hours === 'closed_day' || own.hours === 'outside_hours') {
        warnings.push({ slotId: slot.id, optionId: chosen.id, kind: 'closed', message: hoursMessage(chosen, own, slot.day) })
      }
      // A booked slot is past its deadline by definition.
      if (slot.status === 'decided' && own.deadline && own.deadline.state !== 'later') {
        warnings.push({
          slotId: slot.id,
          optionId: chosen.id,
          kind: own.deadline.state === 'passed' ? 'deadline_passed' : 'deadline_soon',
          message: own.deadline.state === 'passed' ? `Reservations closed ${shortDate(own.deadline.date)}` : `Reserve by ${shortDate(own.deadline.date)}`,
        })
      }
      continue
    }

    const deadline = decisionDeadline(slot)
    const state = deadline ? deadlineState(deadline, context.timeZone, context.now) : null
    if (deadline && state && state !== 'later') {
      warnings.push({
        slotId: slot.id,
        optionId: null,
        kind: state === 'passed' ? 'deadline_passed' : 'deadline_soon',
        message: state === 'passed' ? `Deadline passed ${shortDate(deadline)}` : `Decide by ${shortDate(deadline)}`,
      })
    }
  }

  return { facts, warnings }
}
