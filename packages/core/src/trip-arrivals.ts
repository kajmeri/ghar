import { z } from 'zod'
import { instantFromWallClock, isWallClock, type TimeZone } from './dates'
import { ValidationError } from './errors'
import { MAIL_BODY_MAX_CHARS } from './mail'

// When everyone gets there and leaves, so the group can see who lands when and who's picking
// them up. Each person on the trip has at most one way in and one way out. A pasted confirmation
// can fill them in, but only the travel itself is kept: never a confirmation code, a seat or a price.

export const ARRIVAL_DIRECTIONS = ['arriving', 'leaving'] as const
export type ArrivalDirection = (typeof ARRIVAL_DIRECTIONS)[number]

export const ARRIVAL_MODES = ['flight', 'train', 'bus', 'car', 'other'] as const
export type ArrivalMode = (typeof ARRIVAL_MODES)[number]

export const ARRIVAL_MODE_LABELS: Record<ArrivalMode, string> = {
  flight: 'Flight',
  train: 'Train',
  bus: 'Bus',
  car: 'Driving',
  other: 'Other',
}

/** An airport code, a station, "the house". */
export const ARRIVAL_PLACE_MAX_LENGTH = 80
/** A flight or train number, "TP 202". */
export const ARRIVAL_NUMBER_MAX_LENGTH = 20
/** What someone can paste in to be read. The same cut as a mailbox message. */
export const ARRIVAL_PASTE_MAX_LENGTH = MAIL_BODY_MAX_CHARS
/** Confirmations one account can have read in a day, across every trip. Each one is a model call. */
export const ARRIVAL_READS_PER_DAY = 20

export interface ArrivalFields {
  readonly direction: ArrivalDirection
  readonly mode: ArrivalMode
  readonly at: Date
  readonly place: string | null
  readonly number: string | null
  /** Would like someone to pick them up, or drop them off. */
  readonly wantsRide: boolean
}

function tidy(value: string | null, max: number, field: string, label: string): string | null {
  const text = value?.trim().replace(/\s+/g, ' ') ?? ''
  if (text === '') return null
  if (text.length > max) {
    const message = `${label} can be up to ${String(max)} characters.`
    throw new ValidationError(message, { details: { fieldErrors: { [field]: [message] } } })
  }
  return text
}

/** Trims what was typed, and keeps a flight number's letters upper-case. */
export function arrivalFields(input: ArrivalFields): ArrivalFields {
  const number = tidy(input.number, ARRIVAL_NUMBER_MAX_LENGTH, 'number', 'The number')
  return {
    ...input,
    place: tidy(input.place, ARRIVAL_PLACE_MAX_LENGTH, 'place', 'The place'),
    number: number === null ? null : number.toUpperCase(),
  }
}

/** Whether a ride is still needed, arranged, or not wanted. */
export type RideState = 'none' | 'wanted' | 'arranged'

export function rideState(arrival: { readonly wantsRide: boolean; readonly rideUserId: string | null }): RideState {
  if (!arrival.wantsRide) return 'none'
  return arrival.rideUserId === null ? 'wanted' : 'arranged'
}

/** Earliest first; a tie goes arrivals before departures, then by name so the order holds still. */
export function sortArrivals<T extends { readonly at: Date; readonly direction: ArrivalDirection; readonly name: string | null }>(
  arrivals: readonly T[]
): T[] {
  return arrivals.toSorted(
    (a, b) =>
      a.at.getTime() - b.at.getTime() ||
      ARRIVAL_DIRECTIONS.indexOf(a.direction) - ARRIVAL_DIRECTIONS.indexOf(b.direction) ||
      (a.name ?? '').localeCompare(b.name ?? '')
  )
}

// ---------------------------------------------------------------------------------------------
// Reading a pasted confirmation
// ---------------------------------------------------------------------------------------------

const nullableText = (description: string) => z.string().nullable().describe(description)

/** The one JSON object the model must return. Every field is present, null when the text doesn't say. */
export const arrivalExtractSchema = z.object({
  isTravel: z
    .boolean()
    .describe(
      'True only when the text confirms a flight, train or bus journey with a time. False for anything else, with every other field null.'
    ),
  mode: z.enum(['flight', 'train', 'bus']).nullable().describe('How they travel.'),
  arrivalPlace: nullableText(
    'Where the journey to the trip ends: the three-letter airport code for a flight, otherwise the station or stop.'
  ),
  arrivalAt: nullableText('When the journey to the trip arrives there, in local time as printed, as YYYY-MM-DDTHH:mm.'),
  arrivalNumber: nullableText('The flight or train number of the last leg into that place, like TP 202.'),
  departurePlace: nullableText('Where the journey home starts: the three-letter airport code for a flight, otherwise the station or stop.'),
  departureAt: nullableText('When the journey home leaves there, in local time as printed, as YYYY-MM-DDTHH:mm.'),
  departureNumber: nullableText('The flight or train number of the first leg of the journey home.'),
})
export type ArrivalExtract = z.infer<typeof arrivalExtractSchema>

/** A way in or out as the model read it, for a person to check before it's saved. */
export interface ArrivalDraft {
  mode: ArrivalMode
  at: Date
  place: string | null
  number: string | null
}

function instantOrNull(value: string | null, timeZone: TimeZone): Date | null {
  // The model sometimes adds seconds or uses a space. The wall clock is what matters.
  const wall = (value ?? '').trim().replace(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/, '$1T$2')
  return isWallClock(wall) ? instantFromWallClock(wall, timeZone) : null
}

function shortText(value: string | null, max: number): string | null {
  const text = value?.trim().replace(/\s+/g, ' ') ?? ''
  return text === '' ? null : text.slice(0, max)
}

/**
 * The drafts in an extract, read in the trip's zone as every time on the trip is, so the form
 * shows the times printed on the confirmation. A leg with no time isn't a draft: there'd be
 * nothing to put on the board.
 */
export function arrivalDraftsFromExtract(
  extract: ArrivalExtract,
  timeZone: TimeZone
): { arriving: ArrivalDraft | null; leaving: ArrivalDraft | null } {
  if (!extract.isTravel) return { arriving: null, leaving: null }
  const mode: ArrivalMode = extract.mode ?? 'other'
  const draft = (at: string | null, place: string | null, number: string | null): ArrivalDraft | null => {
    const instant = instantOrNull(at, timeZone)
    if (instant === null) return null
    const code = shortText(number, ARRIVAL_NUMBER_MAX_LENGTH)
    return { mode, at: instant, place: shortText(place, ARRIVAL_PLACE_MAX_LENGTH), number: code === null ? null : code.toUpperCase() }
  }
  return {
    arriving: draft(extract.arrivalAt, extract.arrivalPlace, extract.arrivalNumber),
    leaving: draft(extract.departureAt, extract.departurePlace, extract.departureNumber),
  }
}
