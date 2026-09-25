import 'server-only'
import type {
  CalendarEvent,
  CalendarFeed,
  CalendarItem,
  CalendarLink,
  CalendarSyncResult,
  EventBody,
  PageQuery,
  RequestContext,
} from '@ghar/contracts'
import { can, type HouseholdRole } from '@ghar/core/auth'
import {
  allDayDate,
  allDayLastDate,
  allDayRange,
  buildCalendarFeed,
  describeRecurrence,
  parseRecurrenceRule,
  windowForDates,
  type CalendarItem as CoreCalendarItem,
  type ExpiryDue,
  type FeedSource,
  type HealthDue,
  type MaintenanceDue,
} from '@ghar/core/calendar'
import { todayInTimeZone, type CalendarDate, type TimeZone } from '@ghar/core/dates'
import { healthScheduleTitle } from '@ghar/core/health'
import { personLabel } from '@ghar/core/people'
import * as queries from '@ghar/db/queries'
import type { CalendarLinkRow, EventDetail, EventInput } from '@ghar/db/queries'
import { cache } from 'react'
import { listBillDues } from '@/lib/bills/service'
import { openSecret, sealSecret } from '@/lib/crypto'
import { pageRequest, pageResponse, type PageResult } from '@/lib/api/cursor'
import { getDb } from '@/lib/db'
import { currentHousehold } from '@/lib/households/current'
import { getGoogleCalendarClient } from '@/lib/providers/google-calendar'
import { googleRedirectUri } from './oauth'
import { syncCalendarLink, syncCalendarLinks, type CalendarSyncDeps } from './sync'

// What the /api/v1/calendar routes and the calendar pages call. Permissions are checked in the
// queries; this file joins sources, maps rows to contracts, and runs syncs.

export async function getCalendarSettings(ctx: RequestContext): Promise<{ timezone: TimeZone }> {
  const { timezone } = await currentHousehold(ctx)
  return { timezone }
}

// The calendar page lists the links and then asks for the feed, which needs them too. Keyed on the
// context's parts so both share one read per request; outside a render it reads every time.
const loadCalendarLinkRows = cache((userId: string, householdId: string, role: HouseholdRole) =>
  queries.listCalendarLinks({ userId, householdId, role }, getDb())
)

function calendarLinkRows(ctx: RequestContext): Promise<CalendarLinkRow[]> {
  return loadCalendarLinkRows(ctx.userId, ctx.householdId, ctx.role)
}

/**
 * The sources worth offering as filters: Google once anyone has linked a calendar, then trips,
 * bills, maintenance, expiries and health for the people who can see each.
 */
export function availableFeedSources(ctx: RequestContext, links: readonly Pick<CalendarLink, 'id'>[]): FeedSource[] {
  const sources: FeedSource[] = ['native']
  if (links.length > 0) sources.push('google')
  if (can(ctx.role, 'travel.view')) sources.push('trips')
  if (can(ctx.role, 'finances.view')) sources.push('bills')
  if (can(ctx.role, 'home.view')) sources.push('maintenance')
  if (can(ctx.role, 'documents.view')) sources.push('expiries')
  if (can(ctx.role, 'health.view')) sources.push('health')
  return sources
}

/**
 * Everything on the calendar for a range of days in the household's zone: events, trips, each
 * bill's due dates marked paid or not, connected cards' and loans' next payments, maintenance at
 * its next due date, documents and warranties on the day they run out, and checkups at their next
 * due date for the people the reader may see. Sensitive documents stay off for people who can't see them.
 */
export async function getCalendarFeed(
  ctx: RequestContext,
  input: { from: CalendarDate; to: CalendarDate; sources: FeedSource[] }
): Promise<CalendarFeed> {
  const db = getDb()
  const { timezone, currency } = await currentHousehold(ctx)
  const window = windowForDates(input.from, input.to, timezone)
  const wants = (source: FeedSource) => input.sources.includes(source)
  const range = { from: input.from, to: input.to }
  const today = todayInTimeZone(timezone)

  const [events, bookings, bills, liabilityDues, tasks, documents, warranties, renewals, schedules, links] = await Promise.all([
    wants('native') || wants('google') ? queries.listEventsInWindow(ctx, db, window) : [],
    wants('trips') && can(ctx.role, 'travel.view') ? queries.listTripBookingsInRange(ctx, db, input) : [],
    wants('bills') && can(ctx.role, 'finances.view') ? listBillDues(ctx, db, { ...range, timeZone: timezone, currency }) : [],
    wants('bills') && can(ctx.role, 'finances.view') ? queries.listLiabilityDues(ctx, db, range) : [],
    wants('maintenance') && can(ctx.role, 'home.view')
      ? queries.listMaintenanceTasks(ctx, db, { dueFrom: input.from, dueTo: input.to })
      : [],
    wants('expiries') && can(ctx.role, 'documents.view') ? queries.listDocumentExpiries(ctx, db, range) : [],
    wants('expiries') && can(ctx.role, 'home.view') ? queries.listWarrantyExpiries(ctx, db, range) : [],
    wants('expiries') && can(ctx.role, 'documents.view') ? queries.listRenewalExpiries(ctx, db, range) : [],
    wants('health') && can(ctx.role, 'health.view') ? queries.listHealthSchedules(ctx, db, {}, today) : [],
    // Only whether any calendar is linked, for availableSources.
    can(ctx.role, 'calendar.view') ? calendarLinkRows(ctx) : [],
  ])

  const maintenance: MaintenanceDue[] = tasks.flatMap(task =>
    task.nextDueOn !== null && task.nextDueOn >= input.from && task.nextDueOn <= input.to
      ? [{ id: task.id, title: task.title, dueOn: task.nextDueOn, done: false, assetId: task.assetId }]
      : []
  )
  const expiries: ExpiryDue[] = [
    ...documents.map(document => ({ kind: 'document' as const, id: document.id, title: document.title, expiresOn: document.expiresOn })),
    ...warranties.map(asset => ({
      kind: 'asset' as const,
      id: asset.id,
      title: `${asset.name} warranty`,
      expiresOn: asset.warrantyExpiresOn,
    })),
    ...renewals.map(renewal => ({
      kind: 'renewal' as const,
      id: renewal.id,
      title: renewal.title,
      expiresOn: renewal.expiresOn,
      autoRenews: renewal.autoRenews,
    })),
  ]

  const health: HealthDue[] = schedules.flatMap(schedule =>
    schedule.dueOn >= input.from && schedule.dueOn <= input.to
      ? [
          {
            scheduleId: schedule.id,
            personId: schedule.personId,
            name: healthScheduleTitle(schedule),
            personName:
              schedule.personUserId === ctx.userId
                ? null
                : personLabel({ id: schedule.personId, userId: schedule.personUserId, name: schedule.personName }, ctx.userId),
            dueOn: schedule.dueOn,
          },
        ]
      : []
  )

  const items = buildCalendarFeed({
    window,
    timeZone: timezone,
    today,
    events,
    bookings,
    bills,
    debts: liabilityDues.map(due => ({ accountId: due.accountId, name: due.name, dueOn: due.nextPaymentDueOn, overdue: due.isOverdue })),
    maintenance,
    expiries,
    health,
    sources: input.sources,
  })
  return {
    timezone,
    from: input.from,
    to: input.to,
    sources: input.sources,
    availableSources: availableFeedSources(ctx, links),
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
  const rows = await calendarLinkRows(ctx)
  return rows.map(row => toCalendarLink(ctx, row))
}

/** A page of linked calendars for the API, oldest link first as on the calendar page. */
export async function listCalendarLinksPage(ctx: RequestContext, query: PageQuery): Promise<PageResult<CalendarLink>> {
  const scope = { sort: 'calendar-links:created' }
  const page = await queries.listCalendarLinksPage(ctx, getDb(), pageRequest(query, scope))
  return pageResponse(page, scope, row => toCalendarLink(ctx, row))
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
