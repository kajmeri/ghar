import type { CalendarEvent, CalendarItem, CalendarLink, Member } from '@ghar/contracts'
import {
  allDayDate,
  allDayLastDate,
  type AttendeeResponse,
  type CalendarTone,
  type EventCategory,
  type EventColorToken,
  type FeedSource,
  type MonthKey,
} from '@ghar/core/calendar'
import { addCalendarDays, formatCalendarDate, formatInstant, toCalendarDate, type CalendarDate, type TimeZone } from '@ghar/core/dates'

// Words, links and times for the calendar pages and the event form. Safe for client components:
// nothing here touches the server.

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  household: 'Household',
  school: 'School',
  travel: 'Travel',
  bill: 'Bill',
  maintenance: 'Maintenance',
  personal: 'Personal',
}

/** Categories someone picks for an event. Bills and maintenance come from their own pages. */
export const PICKABLE_CATEGORIES: EventCategory[] = ['household', 'school', 'travel', 'personal']

export const SOURCE_LABELS: Record<FeedSource, string> = {
  native: 'Household',
  google: 'Google',
  trips: 'Trips',
  bills: 'Bills',
  maintenance: 'Maintenance',
}

/** Color on an event says something about it, so the choices are named by meaning. */
export const COLOR_LABELS: Record<EventColorToken, string> = {
  positive: 'Good news',
  caution: 'Needs attention',
  negative: 'Urgent',
}

export const RESPONSE_LABELS: Record<AttendeeResponse, string> = {
  needs_action: 'No answer yet',
  accepted: 'Going',
  tentative: 'Maybe',
  declined: 'Not going',
}

export const TONE_DOT: Record<CalendarTone, string> = {
  default: 'bg-ink-muted',
  positive: 'bg-positive',
  caution: 'bg-caution',
  negative: 'bg-negative',
}

export const TONE_BAR: Record<CalendarTone, string> = {
  default: 'border-l-ink-muted',
  positive: 'border-l-positive',
  caution: 'border-l-caution',
  negative: 'border-l-negative',
}

export const REPEAT_CHOICES = ['none', 'daily', 'weekly', 'monthly', 'yearly', 'custom'] as const
export type RepeatChoice = (typeof REPEAT_CHOICES)[number]

export const REPEAT_LABELS: Record<RepeatChoice, string> = {
  none: 'Doesn’t repeat',
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
  yearly: 'Every year',
  custom: 'Keep the current repeat rule',
}

export const REPEAT_UNITS: Record<Exclude<RepeatChoice, 'none' | 'custom'>, string> = {
  daily: 'days',
  weekly: 'weeks',
  monthly: 'months',
  yearly: 'years',
}

export const ENDS_CHOICES = ['never', 'on', 'after'] as const
export type EndsChoice = (typeof ENDS_CHOICES)[number]

export const ENDS_LABELS: Record<EndsChoice, string> = {
  never: 'Never',
  on: 'On a date',
  after: 'After a number',
}

/** Linking a calendar starts at a route handler, so it's a plain link, never a client navigation. */
export const CONNECT_HREF = '/api/calendar/google/connect'

export function memberName(member: Pick<Member, 'fullName' | 'email'> | undefined): string {
  if (!member) return 'Former member'
  return member.fullName ?? member.email ?? 'Household member'
}

/** `/calendar` for a month and the sources shown, leaving out whatever is already the default. */
export function calendarHref({
  month,
  sources,
  available,
}: {
  month: MonthKey | null
  sources: readonly FeedSource[]
  available: readonly FeedSource[]
}): string {
  const params = new URLSearchParams()
  if (month !== null) params.set('month', month)
  const shown = available.filter(source => sources.includes(source))
  if (shown.length < available.length) params.set('sources', shown.join(','))
  const query = params.toString()
  return query ? `/calendar?${query}` : '/calendar'
}

/** "Today, Sunday, September 13", "Tomorrow, …", or just the date. */
export function dayLabel(date: CalendarDate, today: CalendarDate): string {
  const formatted = formatCalendarDate(date, 'EEEE, MMMM d')
  if (date === today) return `Today, ${formatted}`
  if (date === addCalendarDays(today, 1)) return `Tomorrow, ${formatted}`
  return formatted
}

/**
 * When an event happens, in words. Give `occurrenceStart` to describe one repeat of a series: it
 * keeps the series' length.
 */
export function eventWhen(
  event: Pick<CalendarEvent, 'allDay' | 'startsAt' | 'endsAt'>,
  timeZone: TimeZone,
  occurrenceStart: string | null = null
): string {
  const start = new Date(occurrenceStart ?? event.startsAt)
  const end = new Date(start.getTime() + (Date.parse(event.endsAt) - Date.parse(event.startsAt)))

  if (event.allDay) {
    const first = allDayDate(start)
    const last = allDayLastDate(start, end)
    return first === last
      ? formatCalendarDate(first, 'EEEE, MMMM d, yyyy')
      : `${formatCalendarDate(first, 'EEE, MMM d')} – ${formatCalendarDate(last, 'EEE, MMM d, yyyy')}`
  }

  const clockOf = (instant: Date) => formatInstant(instant, timeZone, { hour: 'numeric', minute: '2-digit' })
  const day = formatInstant(start, timeZone, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  if (start.getTime() === end.getTime()) return `${day}, ${clockOf(start)}`
  if (toCalendarDate(start, timeZone) === toCalendarDate(end, timeZone)) {
    return `${day}, ${clockOf(start)} – ${clockOf(end)}`
  }
  const full = (instant: Date) => formatInstant(instant, timeZone, { dateStyle: 'medium', timeStyle: 'short' })
  return `${full(start)} – ${full(end)}`
}

/** What `/calendar?calendar=` can report after linking a Google Calendar. */
export const CONNECT_STATUSES = [
  'connected',
  'connected_sync_failed',
  'cancelled',
  'expired',
  'denied',
  'taken',
  'forbidden',
  'unavailable',
  'failed',
] as const
export type ConnectStatus = (typeof CONNECT_STATUSES)[number]

export const CONNECT_MESSAGES: Record<ConnectStatus, { tone: 'positive' | 'caution'; text: string }> = {
  connected: { tone: 'positive', text: 'Google Calendar connected. Its events are on the calendar.' },
  connected_sync_failed: {
    tone: 'caution',
    text: 'Google Calendar connected, but the first sync didn’t finish. It tries again every morning, or use Sync now.',
  },
  cancelled: { tone: 'caution', text: 'Connecting was cancelled. Nothing was linked.' },
  expired: {
    tone: 'caution',
    text: 'That sign-in took too long or came from another session. Try connecting again.',
  },
  denied: {
    tone: 'caution',
    text: 'Google didn’t grant access to your calendar. Try again and allow calendar access.',
  },
  taken: {
    tone: 'caution',
    text: 'That Google Calendar is already linked to another household.',
  },
  forbidden: { tone: 'caution', text: 'Your role can’t link calendars. Ask an owner.' },
  unavailable: {
    tone: 'caution',
    text: 'Calendar connections aren’t set up on this server yet.',
  },
  failed: { tone: 'caution', text: 'Connecting didn’t work. Try again in a minute.' },
}

export function isConnectStatus(value: unknown): value is ConnectStatus {
  return typeof value === 'string' && (CONNECT_STATUSES as readonly string[]).includes(value)
}

/** Where an item opens, or null for sources without a page yet. */
export function itemHref(item: CalendarItem): string | null {
  switch (item.ref.kind) {
    case 'event':
      return item.recurring
        ? `/calendar/events/${item.ref.eventId}?occurrence=${encodeURIComponent(item.ref.occurrenceStart)}`
        : `/calendar/events/${item.ref.eventId}`
    case 'booking':
      return `/travel/bookings/${item.ref.bookingId}`
    default:
      return null
  }
}

function clock(iso: string, timeZone: TimeZone): string {
  return formatInstant(new Date(iso), timeZone, { hour: 'numeric', minute: '2-digit' })
}

/** An item's time as seen on one of its days: "9:00 AM – 10:30 AM", "Until 1:00 AM", "All day". */
export function itemTimeOnDay(item: CalendarItem, date: CalendarDate, timeZone: TimeZone): string {
  if (item.allDay) return 'All day'
  const first = date === item.startDate
  const last = date === item.endDate
  if (first && last) {
    return item.startsAt === item.endsAt
      ? clock(item.startsAt, timeZone)
      : `${clock(item.startsAt, timeZone)} – ${clock(item.endsAt, timeZone)}`
  }
  if (first) return `From ${clock(item.startsAt, timeZone)}`
  if (last) return `Until ${clock(item.endsAt, timeZone)}`
  return 'All day'
}

/** The start time for a month cell, or nothing for all-day items and continuing days. */
export function itemStartOnDay(item: CalendarItem, date: CalendarDate, timeZone: TimeZone): string | null {
  if (item.allDay || date !== item.startDate) return null
  return formatInstant(new Date(item.startsAt), timeZone, { hour: 'numeric', minute: '2-digit' })
}

export function linkSyncedText(link: CalendarLink, timeZone: TimeZone): string {
  if (link.lastSyncedAt === null) return 'Not synced yet'
  return `Synced ${formatInstant(new Date(link.lastSyncedAt), timeZone, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })}`
}
