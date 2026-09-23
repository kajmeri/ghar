import type { ItineraryOption, ItinerarySlot, ItineraryWarningValue, OptionFactsValue } from '@ghar/contracts'
import { formatCalendarDate, formatInstant } from '@ghar/core/dates'
import {
  SLOT_BAND_LABELS,
  chosenOptionOf,
  compareSlots,
  optionTotalCents,
  tallyOptionVotes,
  type CostBasis,
  type SlotKind,
  type SlotPosition,
} from '@ghar/core/itinerary'
import { formatCents } from '@ghar/core/money'

/**
 * How the itinerary reads on screen. The rules are @ghar/core's; this turns what they decided into
 * words, once, so the timeline, the compare view, the decisions queue and the day sheet all say the
 * same thing the same way. Safe on the client and the server.
 */

// Density

export const DENSITIES = ['compact', 'comfortable'] as const
export type Density = (typeof DENSITIES)[number]

/** One cookie per person, so two people sharing a laptop keep their own setting. */
export function densityCookieName(userId: string): string {
  return `ghar_itinerary_density_${userId}`
}

export function parseDensity(value: string | undefined): Density {
  return value === 'comfortable' ? 'comfortable' : 'compact'
}

// Positions

/** A slot as @ghar/core orders it, with the wire shape carried alongside. */
export interface PositionedSlot extends SlotPosition {
  readonly endsAt: Date | null
  readonly slot: ItinerarySlot
}

export function positioned(slot: ItinerarySlot): PositionedSlot {
  return {
    id: slot.id,
    day: slot.day,
    band: slot.band,
    startsAt: slot.startsAt === null ? null : new Date(slot.startsAt),
    endsAt: slot.endsAt === null ? null : new Date(slot.endsAt),
    sortOrder: slot.sortOrder,
    slot,
  }
}

// Words

/** "7:30 PM" when the slot has a time, "Evening" when it only has a part of the day. */
export function slotTimeLabel(slot: Pick<ItinerarySlot, 'startsAt' | 'band'>, timeZone: string): string {
  return slot.startsAt === null ? SLOT_BAND_LABELS[slot.band] : formatInstant(new Date(slot.startsAt), timeZone, { timeStyle: 'short' })
}

export function slotWhenLabel(slot: Pick<ItinerarySlot, 'day' | 'startsAt' | 'band' | 'endsAt'>, timeZone: string): string {
  const until = slot.endsAt === null ? '' : `–${formatInstant(new Date(slot.endsAt), timeZone, { timeStyle: 'short' })}`
  return `${formatCalendarDate(slot.day, 'EEE, MMM d')} · ${slotTimeLabel(slot, timeZone)}${until}`
}

/** What an empty slot's row invites you to do. */
export function emptySlotPrompt(slot: Pick<ItinerarySlot, 'kind' | 'label'>): string {
  if (slot.kind === 'meal') return `Add ${slot.label.toLowerCase()}`
  if (slot.kind === 'activity' && ['morning', 'afternoon', 'evening'].includes(slot.label.toLowerCase())) {
    return `Plan the ${slot.label.toLowerCase()}`
  }
  return `Add an option for ${slot.label}`
}

export function formatMinutes(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes))
  if (rounded < 60) return `${rounded} min`
  const hours = Math.floor(rounded / 60)
  const rest = rounded % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`
}

const MODE_WORDS: Record<NonNullable<OptionFactsValue['travel']>['mode'], string> = {
  walk: 'walk',
  transit: 'by transit',
  drive: 'drive',
}

export type Tone = 'neutral' | 'caution' | 'negative'

/** One attribute of one option, as the compare view shows it. */
export interface Cell {
  readonly text: string
  readonly detail: string | null
  readonly tone: Tone
  /** Nothing is known. Shown quieter than a real value. */
  readonly unknown: boolean
}

const cell = (text: string, detail: string | null = null, tone: Tone = 'neutral', unknown = false): Cell => ({ text, detail, tone, unknown })

export function costCell(option: Pick<ItineraryOption, 'costCents' | 'costBasis'>, travelers: number): Cell {
  const total = optionTotalCents(option, travelers)
  if (total === null || option.costCents === null) return cell('No price', null, 'neutral', true)
  if (option.costBasis === 'per_person' && travelers > 1) return cell(formatCents(total), `${formatCents(option.costCents)} each`)
  return cell(formatCents(total))
}

export function durationCell(option: Pick<ItineraryOption, 'durationMinutes'>): Cell {
  return option.durationMinutes === null ? cell('Not given', null, 'neutral', true) : cell(formatMinutes(option.durationMinutes))
}

export function travelCell(facts: OptionFactsValue | undefined): Cell {
  if (!facts?.travel) return cell(facts?.fromTitle ? 'No location' : 'First stop', null, 'neutral', true)
  const { minutes, meters, mode } = facts.travel
  const text = minutes === 0 ? 'Same place' : `${formatMinutes(minutes)} ${MODE_WORDS[mode]}`
  const from = facts.fromTitle ? ` from ${facts.fromTitle}` : ''
  return cell(text, `${formatDistance(meters)}${from}`, facts.arrival === 'late' ? 'negative' : 'neutral')
}

export function hoursCell(option: Pick<ItineraryOption, 'opensAt' | 'closesAt' | 'closedDays'>, facts: OptionFactsValue | undefined): Cell {
  const hours = option.opensAt && option.closesAt ? `${option.opensAt}–${option.closesAt}` : null
  switch (facts?.hours) {
    case 'open':
      return cell(hours ?? 'Open', 'Open then')
    case 'closed_day':
      return cell(hours ?? 'Closed', 'Closed that day', 'negative')
    case 'outside_hours':
      return cell(hours ?? 'Closed', 'Closed then', 'negative')
    default:
      return hours ? cell(hours) : cell('Hours unknown', null, 'neutral', true)
  }
}

export function bookingCell(
  option: Pick<ItineraryOption, 'bookingRequired' | 'bookingDeadline' | 'confirmationCode'>,
  facts: OptionFactsValue | undefined
): Cell {
  if (option.confirmationCode) return cell('Reserved', option.confirmationCode)
  if (!option.bookingRequired) return cell('Not needed')
  const deadline = facts?.deadline ?? (option.bookingDeadline ? { date: option.bookingDeadline, state: 'later' as const } : null)
  if (!deadline) return cell('Needed')
  const date = formatCalendarDate(deadline.date, 'MMM d')
  if (deadline.state === 'passed') return cell('Needed', `Deadline passed ${date}`, 'negative')
  return cell('Needed', `By ${date}`, deadline.state === 'soon' ? 'caution' : 'neutral')
}

export function votesCell(option: Pick<ItineraryOption, 'votes'>): Cell {
  const tally = tallyOptionVotes(option.votes)
  if (tally.voters === 0) return cell('No votes', null, 'neutral', true)
  const parts = [`${tally.yes} yes`, tally.maybe > 0 ? `${tally.maybe} maybe` : null, tally.no > 0 ? `${tally.no} no` : null]
  return cell(parts.filter(Boolean).join(' · '))
}

export const COMPARE_ATTRIBUTES = [
  { key: 'cost', label: 'Cost' },
  { key: 'duration', label: 'Takes' },
  { key: 'travel', label: 'Getting there' },
  { key: 'hours', label: 'Hours' },
  { key: 'booking', label: 'Reservation' },
  { key: 'votes', label: 'Votes' },
] as const
export type CompareKey = (typeof COMPARE_ATTRIBUTES)[number]['key']

export function optionCells(option: ItineraryOption, facts: OptionFactsValue | undefined, travelers: number): Record<CompareKey, Cell> {
  return {
    cost: costCell(option, travelers),
    duration: durationCell(option),
    travel: travelCell(facts),
    hours: hoursCell(option, facts),
    booking: bookingCell(option, facts),
    votes: votesCell(option),
  }
}

export interface CompareRow {
  readonly key: CompareKey
  readonly label: string
  readonly cells: readonly Cell[]
  /** False when every option says the same thing, which the grid shows muted. */
  readonly varies: boolean
}

/** Options across, attributes down. */
export function compareRows(
  options: readonly ItineraryOption[],
  facts: ReadonlyMap<string, OptionFactsValue>,
  travelers: number
): CompareRow[] {
  const cells = options.map(option => optionCells(option, facts.get(option.id), travelers))
  return COMPARE_ATTRIBUTES.map(({ key, label }) => {
    const row = cells.map(each => each[key])
    return { key, label, cells: row, varies: new Set(row.map(each => `${each.text}|${each.detail ?? ''}`)).size > 1 }
  })
}

export function warningTone(kind: ItineraryWarningValue['kind']): Exclude<Tone, 'neutral'> {
  return kind === 'deadline_soon' ? 'caution' : 'negative'
}

export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-ink',
  caution: 'text-caution-ink',
  negative: 'text-negative',
}

/** Meals and tickets are priced per head; a room or a car is priced for everyone. */
export function defaultCostBasis(kind: SlotKind): CostBasis {
  return kind === 'meal' || kind === 'activity' ? 'per_person' : 'total'
}

export function isLikelyUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim())
}

// The agenda: what is actually happening

export interface AgendaEntry {
  readonly slot: ItinerarySlot
  readonly option: ItineraryOption
}

/**
 * The settled plan for one day: decided and booked slots with the option they settled on, in
 * order. The day sheet and travel mode both read this, so neither shows an undecided dinner.
 */
export function agendaFor(slots: readonly ItinerarySlot[], day: string): AgendaEntry[] {
  return slots
    .filter(slot => slot.day === day)
    .map(positioned)
    .sort(compareSlots)
    .flatMap(({ slot }) => {
      const option = chosenOptionOf(slot)
      return option ? [{ slot, option }] : []
    })
}

export function mapLink(option: Pick<ItineraryOption, 'lat' | 'lng' | 'address'>): string | null {
  if (option.lat !== null && option.lng !== null) {
    return `https://www.openstreetmap.org/?mlat=${option.lat}&mlon=${option.lng}#map=16/${option.lat}/${option.lng}`
  }
  return option.address ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(option.address)}` : null
}
