import { startOfDayInTimeZone, toCalendarDate, type CalendarDate, type TimeZone } from '../dates'
import { allDayDate, allDayLastDate } from './all-day'
import {
  billItems,
  expiryItems,
  maintenanceItems,
  tripItems,
  type BillDue,
  type ExpiryDue,
  type MaintenanceDue,
  type TripBooking,
} from './derived'
import { expandOccurrences, parseRecurrenceRule } from './recurrence'
import {
  FEED_SOURCES,
  type CalendarProvider,
  type CalendarTone,
  type CalendarWindow,
  type EventCategory,
  type EventColorToken,
  type FeedSource,
} from './types'

// The one place calendar items come together: native events (with their repeats expanded),
// events synced from linked calendars, and items derived from trips, bills, maintenance and
// expiry dates. The API and every calendar view read this, so they can't disagree about what's on
// a day.

/** What an item opens. The web app turns these into links. */
export type CalendarItemRef =
  | { kind: 'event'; eventId: string; occurrenceStart: Date }
  | { kind: 'booking'; bookingId: string }
  | { kind: 'bill'; billId: string }
  | { kind: 'maintenance'; taskId: string; assetId: string | null }
  | { kind: 'document'; documentId: string }
  | { kind: 'asset'; assetId: string }

export interface CalendarItem {
  /** Stable across reads, so it can key a list. Unique within one feed. */
  id: string
  source: FeedSource
  title: string
  location: string | null
  /** For all-day items, 00:00 UTC of the first day; endsAt is exclusive. */
  startsAt: Date
  endsAt: Date
  allDay: boolean
  /** The first and last day it covers: the stored dates when all-day, else in the household's zone. */
  startDate: CalendarDate
  endDate: CalendarDate
  category: EventCategory
  tone: CalendarTone
  recurring: boolean
  ref: CalendarItemRef
}

export type CalendarItemInput = Omit<CalendarItem, 'startDate' | 'endDate'>

/** An `events` row as the feed needs it. */
export interface FeedEvent {
  id: string
  title: string
  location: string | null
  startsAt: Date
  endsAt: Date
  allDay: boolean
  rrule: string | null
  category: EventCategory
  colorToken: EventColorToken | null
  /** Null for a native event. */
  externalSource: CalendarProvider | null
  externalId: string | null
}

export interface CalendarFeedInput {
  window: CalendarWindow
  timeZone: TimeZone
  /** Today in the household's zone, for due-date tones. */
  today: CalendarDate
  events: readonly FeedEvent[]
  bookings?: readonly TripBooking[]
  bills?: readonly BillDue[]
  maintenance?: readonly MaintenanceDue[]
  expiries?: readonly ExpiryDue[]
  /** Which sources to include. Everything when omitted. */
  sources?: readonly FeedSource[]
}

/** The window for a range of days in the household's zone: from the first day's start to the day after the last. */
export function windowForDates(from: CalendarDate, to: CalendarDate, timeZone: TimeZone): CalendarWindow {
  const start = startOfDayInTimeZone(from, timeZone)
  const dayAfter = new Date(Date.UTC(...ymd(to)) + 86_400_000).toISOString().slice(0, 10)
  return { start, end: startOfDayInTimeZone(dayAfter, timeZone) }
}

function ymd(date: CalendarDate): [number, number, number] {
  const [year, month, day] = date.split('-').map(Number)
  return [year ?? 0, (month ?? 1) - 1, day ?? 1]
}

function withDates(item: CalendarItemInput, timeZone: TimeZone): CalendarItem {
  if (item.allDay) {
    return {
      ...item,
      startDate: allDayDate(item.startsAt),
      endDate: allDayLastDate(item.startsAt, item.endsAt),
    }
  }
  const startDate = toCalendarDate(item.startsAt, timeZone)
  // endsAt is exclusive: an event ending at midnight doesn't touch the next day.
  const lastInstant = item.endsAt.getTime() > item.startsAt.getTime() ? new Date(item.endsAt.getTime() - 1) : item.startsAt
  const endDate = toCalendarDate(lastInstant, timeZone)
  return { ...item, startDate, endDate: endDate < startDate ? startDate : endDate }
}

/** Where an item sits on a timeline in the household's zone. All-day items start at local midnight. */
function sortStart(item: CalendarItem, timeZone: TimeZone): number {
  return item.allDay ? startOfDayInTimeZone(item.startDate, timeZone).getTime() : item.startsAt.getTime()
}

function overlapsWindow(item: CalendarItem, window: CalendarWindow, timeZone: TimeZone): boolean {
  const start = sortStart(item, timeZone)
  const end = item.allDay ? windowForDates(item.startDate, item.endDate, timeZone).end.getTime() : item.endsAt.getTime()
  if (start >= window.end.getTime()) return false
  if (end > window.start.getTime()) return true
  return end === start && start >= window.start.getTime()
}

function eventItems(event: FeedEvent, window: CalendarWindow, timeZone: TimeZone): CalendarItemInput[] {
  const source: FeedSource = event.externalSource === null ? 'native' : event.externalSource
  // All-day occurrences are matched by date, so widen the window by a day each side and let the
  // overlap check below trim it in the household's zone.
  const wide: CalendarWindow = event.allDay
    ? {
        start: new Date(window.start.getTime() - 86_400_000),
        end: new Date(window.end.getTime() + 86_400_000),
      }
    : window
  let rule = null
  if (event.rrule !== null) {
    try {
      rule = parseRecurrenceRule(event.rrule)
    } catch {
      // Stored rules are validated on the way in. One that stopped parsing shows its first occurrence only.
      rule = null
    }
  }
  return expandOccurrences({ ...event, rule }, wide, timeZone).map(occurrence => ({
    id:
      source === 'google' && event.externalId !== null
        ? `google:${event.externalId}`
        : `${source}:${event.id}:${occurrence.startsAt.toISOString()}`,
    source,
    title: event.title,
    location: event.location,
    startsAt: occurrence.startsAt,
    endsAt: occurrence.endsAt,
    allDay: event.allDay,
    category: event.category,
    tone: event.colorToken ?? 'default',
    recurring: rule !== null,
    ref: { kind: 'event', eventId: event.id, occurrenceStart: occurrence.startsAt },
  }))
}

/** Soonest first. On the same day, all-day items lead, then by time, then by title. */
export function compareCalendarItems(a: CalendarItem, b: CalendarItem, timeZone: TimeZone): number {
  return (
    sortStart(a, timeZone) - sortStart(b, timeZone) ||
    Number(b.allDay) - Number(a.allDay) ||
    a.endsAt.getTime() - b.endsAt.getTime() ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id)
  )
}

/**
 * Merges every source into one list for the window, sorted. A Google event that two people in the
 * household both have (both were invited) shows once.
 */
export function buildCalendarFeed(input: CalendarFeedInput): CalendarItem[] {
  const wanted = new Set<FeedSource>(input.sources ?? FEED_SOURCES)
  const raw: CalendarItemInput[] = []

  for (const event of input.events) {
    const source: FeedSource = event.externalSource === null ? 'native' : event.externalSource
    if (wanted.has(source)) raw.push(...eventItems(event, input.window, input.timeZone))
  }
  if (wanted.has('trips')) raw.push(...tripItems(input.bookings ?? []))
  if (wanted.has('bills')) raw.push(...billItems(input.bills ?? [], input.today))
  if (wanted.has('maintenance')) raw.push(...maintenanceItems(input.maintenance ?? [], input.today))
  if (wanted.has('expiries')) raw.push(...expiryItems(input.expiries ?? [], input.today))

  const seen = new Set<string>()
  const items: CalendarItem[] = []
  for (const candidate of raw) {
    const item = withDates(candidate, input.timeZone)
    if (!overlapsWindow(item, input.window, input.timeZone)) continue
    // Google instance ids are shared across attendees' calendars; the start keeps a moved
    // instance distinct from a stale copy.
    const key = item.source === 'google' ? `${item.id}:${item.startsAt.toISOString()}` : item.id
    if (seen.has(key)) continue
    seen.add(key)
    items.push(item.source === 'google' ? { ...item, id: key } : item)
  }
  return items.sort((a, b) => compareCalendarItems(a, b, input.timeZone))
}

/** Reads a source filter from a query string: a comma list or repeated values. Unknown names drop out; nothing valid means everything. */
export function parseFeedSources(value: string | readonly string[] | null | undefined): FeedSource[] {
  const names = (typeof value === 'string' ? [value] : (value ?? [])).flatMap(part => part.split(',')).map(part => part.trim())
  const sources = FEED_SOURCES.filter(source => names.includes(source))
  return sources.length > 0 ? sources : [...FEED_SOURCES]
}
