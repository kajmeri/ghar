import 'server-only'
import type {
  CalendarEvent,
  CalendarFeed,
  CalendarItem,
  CalendarLink,
  CalendarSyncResult,
  EventBody,
  RequestContext,
} from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import {
  allDayDate,
  allDayLastDate,
  allDayRange,
  buildCalendarFeed,
  describeRecurrence,
  parseRecurrenceRule,
  windowForDates,
  type CalendarItem as CoreCalendarItem,
  type FeedSource,
} from '@ghar/core/calendar'
import { todayInTimeZone, type CalendarDate, type TimeZone } from '@ghar/core/dates'
import * as queries from '@ghar/db/queries'
import type { CalendarLinkRow, EventDetail, EventInput } from '@ghar/db/queries'
import { openSecret, sealSecret } from '@/lib/crypto'
import { getDb } from '@/lib/db'
import { getGoogleCalendarClient } from '@/lib/providers/google-calendar'
import { googleRedirectUri } from './oauth'
import { syncCalendarLink, syncCalendarLinks, type CalendarSyncDeps } from './sync'

// What the /api/v1/calendar routes and the calendar pages call. Permissions are checked in the
// queries; this file joins sources, maps rows to contracts, and runs syncs.

export async function getCalendarSettings(ctx: RequestContext): Promise<{ timezone: TimeZone }> {
  const { timezone } = await queries.getHousehold(ctx, getDb())
  return { timezone }
}

/**
 * The sources worth offering as filters: Google once anyone has linked a calendar, trips for
 * people who can see travel. Bills and maintenance join when they have tables.
 */
export function availableFeedSources(ctx: RequestContext, links: readonly CalendarLink[]): FeedSource[] {
  const sources: FeedSource[] = ['native']
  if (links.length > 0) sources.push('google')
  if (can(ctx.role, 'travel.view')) sources.push('trips')
  return sources
}

/**
 * Everything on the calendar for a range of days in the household's zone. Bills and maintenance
 * have no tables yet, so those sources are empty until they do.
 */
export async function getCalendarFeed(
  ctx: RequestContext,
  input: { from: CalendarDate; to: CalendarDate; sources: FeedSource[] }
): Promise<CalendarFeed> {
  const db = getDb()
  const { timezone } = await getCalendarSettings(ctx)
  const window = windowForDates(input.from, input.to, timezone)
  const wants = (source: FeedSource) => input.sources.includes(source)

  const [events, bookings] = await Promise.all([
    wants('native') || wants('google') ? queries.listEventsInWindow(ctx, db, window) : [],
    wants('trips') && can(ctx.role, 'travel.view') ? queries.listTripBookingsInRange(ctx, db, input) : [],
  ])

  const items = buildCalendarFeed({
    window,
    timeZone: timezone,
    today: todayInTimeZone(timezone),
    events,
    bookings,
    bills: [],
    maintenance: [],
    sources: input.sources,
  })
  return {
    timezone,
    from: input.from,
    to: input.to,
    sources: input.sources,
    items: items.map(toCalendarItem),
  }
}

function toCalendarItem(item: CoreCalendarItem): CalendarItem {
  return {
    ...item,
    startsAt: item.startsAt.toISOString(),
    endsAt: item.endsAt.toISOString(),
    ref: item.ref.kind === 'event' ? { ...item.ref, occurrenceStart: item.ref.occurrenceStart.toISOString() } : item.ref,
  }
}

function toCalendarEvent(ctx: RequestContext, row: EventDetail, timeZone: TimeZone): CalendarEvent {
  let recurrence: string | null = null
  if (row.rrule !== null) {
    try {
      recurrence = describeRecurrence(parseRecurrenceRule(row.rrule), {
        startsAt: row.startsAt,
        allDay: row.allDay,
        timeZone,
      })
    } catch {
      recurrence = null
    }
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    allDay: row.allDay,
    startDate: row.allDay ? allDayDate(row.startsAt) : null,
    endDate: row.allDay ? allDayLastDate(row.startsAt, row.endsAt) : null,
    rrule: row.rrule,
    recurrence,
    category: row.category,
    colorToken: row.colorToken,
    externalSource: row.externalSource,
    editable: row.externalSource === null && can(ctx.role, 'calendar.manage'),
    createdBy: row.createdBy,
    attendees: row.attendees,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function eventInputFromBody(body: EventBody): EventInput {
  const times = body.allDay
    ? allDayRange(body.startDate, body.endDate)
    : { startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt) }
  return {
    title: body.title,
    description: body.description,
    location: body.location,
    allDay: body.allDay,
    ...times,
    rrule: body.rrule,
    category: body.category,
    colorToken: body.colorToken,
    attendeeIds: body.attendeeIds,
  }
}

export async function getEvent(ctx: RequestContext, input: { eventId: string }): Promise<CalendarEvent> {
  const [row, { timezone }] = await Promise.all([queries.getEvent(ctx, getDb(), input), getCalendarSettings(ctx)])
  return toCalendarEvent(ctx, row, timezone)
}

export async function createEvent(ctx: RequestContext, input: EventInput): Promise<CalendarEvent> {
  const [row, { timezone }] = await Promise.all([queries.createEvent(ctx, getDb(), input), getCalendarSettings(ctx)])
  return toCalendarEvent(ctx, row, timezone)
}

export async function updateEvent(ctx: RequestContext, input: EventInput & { eventId: string }): Promise<CalendarEvent> {
  const [row, { timezone }] = await Promise.all([queries.updateEvent(ctx, getDb(), input), getCalendarSettings(ctx)])
  return toCalendarEvent(ctx, row, timezone)
}

export async function deleteEvent(ctx: RequestContext, input: { eventId: string }): Promise<{ eventId: string }> {
  await queries.deleteEvent(ctx, getDb(), input)
  return { eventId: input.eventId }
}

export async function respondToEvent(
  ctx: RequestContext,
  input: { eventId: string; response: CalendarEvent['attendees'][number]['response'] }
): Promise<CalendarEvent> {
  const [row, { timezone }] = await Promise.all([queries.respondToEvent(ctx, getDb(), input), getCalendarSettings(ctx)])
  return toCalendarEvent(ctx, row, timezone)
}

function toCalendarLink(ctx: RequestContext, row: CalendarLinkRow): CalendarLink {
  return {
    ...row,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    mine: row.userId === ctx.userId,
  }
}

export async function listCalendarLinks(ctx: RequestContext): Promise<CalendarLink[]> {
  const rows = await queries.listCalendarLinks(ctx, getDb())
  return rows.map(row => toCalendarLink(ctx, row))
}

function syncDeps(): CalendarSyncDeps {
  return {
    db: getDb(),
    client: getGoogleCalendarClient,
    decrypt: openSecret,
    now: () => new Date(),
  }
}

/**
 * Links the signed-in person's Google Calendar after they allow access, then runs its first sync.
 * A failed first sync still leaves the link; the calendar page shows why.
 */
export async function connectGoogleCalendar(
  ctx: RequestContext,
  input: { code: string }
): Promise<{ link: CalendarLink; sync: CalendarSyncResult }> {
  const client = getGoogleCalendarClient()
  const account = await client.exchangeCode({ code: input.code, redirectUri: googleRedirectUri() })
  const row = await queries.upsertCalendarLink(ctx, getDb(), {
    provider: 'google',
    accountEmail: account.accountEmail,
    calendarId: account.calendarId,
    refreshTokenEncrypted: sealSecret(account.refreshToken),
  })
  const sync = await syncCalendarLink({ ...syncDeps(), client: () => client }, { id: row.id, householdId: ctx.householdId })
  return { link: toCalendarLink(ctx, row), sync }
}

/** Unlinks a calendar, removes what it synced, and tells Google to forget the grant. */
export async function disconnectCalendarLink(ctx: RequestContext, input: { linkId: string }): Promise<{ linkId: string }> {
  const { refreshTokenEncrypted } = await queries.deleteCalendarLink(ctx, getDb(), input)
  try {
    await getGoogleCalendarClient().revoke(openSecret(refreshTokenEncrypted))
  } catch (error) {
    // The link is gone either way. The person can also remove access in their Google account.
    console.warn(`Could not revoke Google access for link ${input.linkId}: ${error instanceof Error ? error.name : 'unknown error'}`)
  }
  return { linkId: input.linkId }
}

/** "Sync now": every linked calendar in the household that doesn't need reconnecting. */
export async function syncHouseholdCalendars(ctx: RequestContext): Promise<CalendarSyncResult[]> {
  const targets = await queries.listHouseholdCalendarLinksForSync(ctx, getDb())
  return syncCalendarLinks(syncDeps(), targets)
}
