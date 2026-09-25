import { addCalendarDays, daysBetween, type CalendarDate } from './dates'
import { ValidationError } from './errors'

// The trip's shared album and the look back once it's over. Signing links and moving bytes are
// I/O, so they live in apps/web; this is what a photo may be, where it lives, and the recap's sums.

/** What the album keeps: photos every browser can show. A phone's HEIC is turned into a JPEG first. */
export const TRIP_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type TripPhotoMimeType = (typeof TRIP_PHOTO_MIME_TYPES)[number]

const EXTENSIONS: Record<TripPhotoMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** A photo shrunk in the browser is well under a megabyte; this is room for one that couldn't be. */
export const MAX_TRIP_PHOTO_BYTES = 10 * 1024 * 1024
export const MAX_TRIP_PHOTOS = 500
export const PHOTO_CAPTION_MAX_LENGTH = 140
/** Most photos added in one go. */
export const PHOTO_BATCH_MAX = 20

export function isTripPhotoMimeType(value: string): value is TripPhotoMimeType {
  return (TRIP_PHOTO_MIME_TYPES as readonly string[]).includes(value)
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const PATH = new RegExp(`^trip-photos/(${UUID})/${UUID}\\.(?:${Object.values(EXTENSIONS).join('|')})$`)

/**
 * Where a trip photo lives in the bucket: under the trip, not a household, because guests add to
 * it too. The object id is random so a path can't be guessed.
 */
export function tripPhotoStoragePath(tripId: string, objectId: string, mimeType: TripPhotoMimeType): string {
  return `trip-photos/${tripId.toLowerCase()}/${objectId.toLowerCase()}.${EXTENSIONS[mimeType]}`
}

/** The trip a storage path belongs to, or null for anything Ghar wouldn't have made. */
export function tripPhotoPathTrip(path: string): string | null {
  return PATH.exec(path)?.[1] ?? null
}

/** Trimmed, with blank as none. */
export function photoCaption(raw: string | null): string | null {
  const text = raw?.trim().replace(/\s+/g, ' ') ?? ''
  if (text === '') return null
  if (text.length > PHOTO_CAPTION_MAX_LENGTH) {
    const message = `Up to ${String(PHOTO_CAPTION_MAX_LENGTH)} characters.`
    throw new ValidationError(message, { details: { fieldErrors: { caption: [message] } } })
  }
  return text
}

/** Days after a trip ends that the recap email can still go out. After that it would be old news. */
export const RECAP_WINDOW_DAYS = 7

/** The trip ended before today and not so long ago that the recap is stale. */
export function recapDue(endsOn: CalendarDate, today: CalendarDate): boolean {
  const since = daysBetween(endsOn, today)
  return since >= 1 && since <= RECAP_WINDOW_DAYS
}

/** The oldest end date a recap is still due for, for the query. */
export function recapWindowStart(today: CalendarDate): CalendarDate {
  return addCalendarDays(today, -RECAP_WINDOW_DAYS)
}

export interface RecapFacts {
  startsOn: CalendarDate
  endsOn: CalendarDate
  /** Everyone who came: the household's travellers, and each guest going with whoever they brought. */
  people: number
  /** Decided or booked plans on the itinerary. */
  plans: number
  photos: number
  /** Payments still to make before everyone's square. */
  openTransfers: number
}

/** The recap's short lines, in the order they read. Nothing is said about what there's none of. */
export function recapLines(facts: RecapFacts): string[] {
  const nights = daysBetween(facts.startsOn, facts.endsOn)
  const count = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`
  return [
    nights === 0 ? 'A day trip' : count(nights, 'night', 'nights'),
    ...(facts.people > 1 ? [count(facts.people, 'person', 'people')] : []),
    ...(facts.plans > 0 ? [count(facts.plans, 'plan', 'plans')] : []),
    ...(facts.photos > 0 ? [count(facts.photos, 'photo', 'photos')] : []),
  ]
}
