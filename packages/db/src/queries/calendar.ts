import { requirePermission } from '@ghar/core/auth'
import {
  normalizeExternalEvent,
  validateEvent,
  type AttendeeResponse,
  type CalendarProvider,
  type CalendarWindow,
  type DateRange,
  type EventFields,
  type InboundSyncPlan,
  type LinkDirection,
  type LinkStatus,
  type TripBooking,
} from '@ghar/core/calendar'
import { addCalendarDays } from '@ghar/core/dates'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@ghar/core/errors'
import { and, asc, eq, inArray, isNotNull, lt, ne, notInArray, or, sql } from 'drizzle-orm'
import { bookings, calendarLinks, eventAttendees, events, householdMembers } from '../schema'
import { recordAudit } from './audit'
import { authorize } from './authorize'
import type { Actor, Db, RequestContext } from './types'

// Native events, the calendars people link, and what a sync writes back. People reach events and
// links with a RequestContext. A sync may run with nobody signed in (the daily cron), so the
// functions it calls take an Actor built from the stored link. listCalendarLinksForSync reads
// across households and takes no context.
//
// Refresh tokens leave this file only through getCalendarLinkCredentials and deleteCalendarLink,
// still encrypted, for apps/web/lib to use. Neither result belongs in a response.

// ---------------------------------------------------------------------------------------------
// Events

export interface AttendeeRow {
  userId: string
  response: AttendeeResponse
}

export interface EventRow extends EventFields {
  id: string
  createdBy: string | null
  externalSource: CalendarProvider | null
  externalId: string | null
  calendarLinkId: string | null
  lastSyncedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface EventDetail extends EventRow {
  attendees: AttendeeRow[]
}

export interface EventInput extends EventFields {
  /** Household members on the event. Omit on update to leave them as they are. */
  attendeeIds?: readonly string[]
}

const eventColumns = {
  id: events.id,
  title: events.title,
  description: events.description,
  location: events.location,
  startsAt: events.startsAt,
  endsAt: events.endsAt,
  allDay: events.allDay,
  rrule: events.rrule,
  category: events.category,
  colorToken: events.colorToken,
  createdBy: events.createdBy,
  externalSource: events.externalSource,
  externalId: events.externalId,
  calendarLinkId: events.calendarLinkId,
  lastSyncedAt: events.lastSyncedAt,
  createdAt: events.createdAt,
  updatedAt: events.updatedAt,
}

const EVENT_NOT_FOUND = 'That event no longer exists.'
const SYNCED_EVENT_READ_ONLY = 'This event comes from a linked Google Calendar. Change it there and it will update here.'

/** All-day rows are UTC dates, which can sit up to a day either side of the household's days. */
const ALL_DAY_SLACK_MS = 86_400_000

function eventKey(actor: Actor, eventId: string) {
  return and(eq(events.id, eventId), eq(events.householdId, actor.householdId))
}

/**
 * Rows the feed needs to render a window: one-off events that overlap it, and repeating events
 * that start before it ends. Repeats are expanded by @ghar/core/calendar, not here.
 */
export async function listEventsInWindow(ctx: RequestContext, db: Db, window: CalendarWindow): Promise<EventRow[]> {
  requirePermission(ctx, 'calendar.view')
  const start = new Date(window.start.getTime() - ALL_DAY_SLACK_MS)
  const end = new Date(window.end.getTime() + ALL_DAY_SLACK_MS)
  return db
    .select(eventColumns)
    .from(events)
    .where(
      and(
        eq(events.householdId, ctx.householdId),
        lt(events.startsAt, end),
        or(isNotNull(events.rrule), sql`${events.endsAt} > ${start}`, sql`${events.startsAt} >= ${start}`)
      )
    )
    .orderBy(asc(events.startsAt), asc(events.id))
}

export async function getEvent(ctx: RequestContext, db: Db, input: { eventId: string }): Promise<EventDetail> {
  requirePermission(ctx, 'calendar.view')
  return readEvent(ctx, db, input.eventId)
}

export async function createEvent(ctx: RequestContext, db: Db, input: EventInput): Promise<EventDetail> {
  requirePermission(ctx, 'calendar.manage')
  const { attendeeIds = [], ...rest } = input
  const fields = validateEvent(rest)
  return db.transaction(async tx => {
    const attendees = await assertAttendeesAreMembers(ctx, tx, attendeeIds)
    const [event] = await tx
      .insert(events)
      .values({ householdId: ctx.householdId, ...fields, createdBy: ctx.userId })
      .returning({ id: events.id })
    if (!event) throw new Error('Event insert returned no row')
    if (attendees.length > 0) {
      await tx.insert(eventAttendees).values(attendees.map(userId => ({ eventId: event.id, userId })))
    }
    await recordAudit(ctx, tx, {
      action: 'event.created',
      entity: 'event',
      entityId: event.id,
      metadata: { category: fields.category, recurring: fields.rrule !== null },
    })
    return readEvent(ctx, tx, event.id)
  })
}

/** Changes the whole series of a repeating event. Attendees keep their answers. */
export async function updateEvent(ctx: RequestContext, db: Db, input: EventInput & { eventId: string }): Promise<EventDetail> {
  requirePermission(ctx, 'calendar.manage')
  const { eventId, attendeeIds, ...rest } = input
  const fields = validateEvent(rest)
  return db.transaction(async tx => {
    await lockNativeEvent(ctx, tx, eventId)
    await tx
      .update(events)
      .set({ ...fields, updatedAt: sql`now()` })
      .where(eventKey(ctx, eventId))

    if (attendeeIds !== undefined) {
      const attendees = await assertAttendeesAreMembers(ctx, tx, attendeeIds)
      await tx
        .delete(eventAttendees)
        .where(
          attendees.length > 0
            ? and(eq(eventAttendees.eventId, eventId), notInArray(eventAttendees.userId, attendees))
            : eq(eventAttendees.eventId, eventId)
        )
      if (attendees.length > 0) {
        await tx
          .insert(eventAttendees)
          .values(attendees.map(userId => ({ eventId, userId })))
          .onConflictDoNothing()
      }
    }

    await recordAudit(ctx, tx, { action: 'event.updated', entity: 'event', entityId: eventId })
    return readEvent(ctx, tx, eventId)
  })
}

/** Deletes the event, or every occurrence of a repeating one. */
export async function deleteEvent(ctx: RequestContext, db: Db, input: { eventId: string }): Promise<void> {
  requirePermission(ctx, 'calendar.manage')
  await db.transaction(async tx => {
    await lockNativeEvent(ctx, tx, input.eventId)
    await tx.delete(events).where(eventKey(ctx, input.eventId))
    await recordAudit(ctx, tx, {
      action: 'event.deleted',
      entity: 'event',
      entityId: input.eventId,
    })
  })
}

/** How the signed-in person answers an event they're on. */
export async function respondToEvent(
  ctx: RequestContext,
  db: Db,
  input: { eventId: string; response: AttendeeResponse }
): Promise<EventDetail> {
  requirePermission(ctx, 'calendar.view')
  return db.transaction(async tx => {
    const [event] = await tx.select({ id: events.id }).from(events).where(eventKey(ctx, input.eventId)).limit(1)
    if (!event) throw new NotFoundError(EVENT_NOT_FOUND)
    const [attendee] = await tx
      .update(eventAttendees)
      .set({ response: input.response })
      .where(and(eq(eventAttendees.eventId, event.id), eq(eventAttendees.userId, ctx.userId)))
      .returning({ userId: eventAttendees.userId })
    if (!attendee) throw new NotFoundError("You're not on this event.")
    return readEvent(ctx, tx, event.id)
  })
}

async function readEvent(actor: Actor, db: Db, eventId: string): Promise<EventDetail> {
  const [event] = await db.select(eventColumns).from(events).where(eventKey(actor, eventId)).limit(1)
  if (!event) throw new NotFoundError(EVENT_NOT_FOUND)
  // Joined to current members, so someone who left the household drops off the event.
  const attendees = await db
    .select({ userId: eventAttendees.userId, response: eventAttendees.response })
    .from(eventAttendees)
    .innerJoin(
      householdMembers,
      and(eq(householdMembers.userId, eventAttendees.userId), eq(householdMembers.householdId, actor.householdId))
    )
    .where(eq(eventAttendees.eventId, eventId))
    .orderBy(asc(householdMembers.joinedAt), asc(eventAttendees.userId))
  return { ...event, attendees }
}

/** Synced events change only through a sync, so only native ones pass. */
async function lockNativeEvent(ctx: RequestContext, tx: Db, eventId: string): Promise<void> {
  const [event] = await tx.select({ externalSource: events.externalSource }).from(events).where(eventKey(ctx, eventId)).for('update')
  if (!event) throw new NotFoundError(EVENT_NOT_FOUND)
  if (event.externalSource !== null) throw new ForbiddenError(SYNCED_EVENT_READ_ONLY)
}

async function assertAttendeesAreMembers(ctx: RequestContext, tx: Db, attendeeIds: readonly string[]): Promise<string[]> {
  const unique = [...new Set(attendeeIds)]
  if (unique.length === 0) return []
  const members = await tx
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, ctx.householdId), inArray(householdMembers.userId, unique)))
  if (members.length !== unique.length) {
    throw new ValidationError('Check the highlighted fields.', {
      details: { fieldErrors: { attendeeIds: ['Only people in this household can be added.'] } },
    })
  }
  return unique
}

// ---------------------------------------------------------------------------------------------
// Linked calendars

export interface CalendarLinkRow {
  id: string
  userId: string
  provider: CalendarProvider
  accountEmail: string
  calendarId: string
  direction: LinkDirection
  status: LinkStatus
  lastError: string | null
  lastSyncedAt: Date | null
  createdAt: Date
}

const linkColumns = {
  id: calendarLinks.id,
  userId: calendarLinks.userId,
  provider: calendarLinks.provider,
  accountEmail: calendarLinks.accountEmail,
  calendarId: calendarLinks.calendarId,
  direction: calendarLinks.direction,
  status: calendarLinks.status,
  lastError: calendarLinks.lastError,
  lastSyncedAt: calendarLinks.lastSyncedAt,
  createdAt: calendarLinks.createdAt,
}

const LINK_NOT_FOUND = 'That calendar is no longer linked.'
const LAST_ERROR_MAX_LENGTH = 500

function linkKey(actor: Actor, linkId: string) {
  return and(eq(calendarLinks.id, linkId), eq(calendarLinks.householdId, actor.householdId))
}

/** Every calendar linked in the household, so members can see whose needs reconnecting. */
export async function listCalendarLinks(ctx: RequestContext, db: Db): Promise<CalendarLinkRow[]> {
  requirePermission(ctx, 'calendar.view')
  return db
    .select(linkColumns)
    .from(calendarLinks)
    .where(eq(calendarLinks.householdId, ctx.householdId))
    .orderBy(asc(calendarLinks.createdAt), asc(calendarLinks.id))
}

/**
 * Links the signed-in person's own calendar, after OAuth. Connecting the same calendar again
 * replaces the token and clears a `needs_reconnect`, keeping the sync token and synced events.
 */
export async function upsertCalendarLink(
  ctx: RequestContext,
  db: Db,
  input: {
    provider: CalendarProvider
    accountEmail: string
    calendarId: string
    /** Already encrypted by apps/web/lib/crypto.ts. */
    refreshTokenEncrypted: string
  }
): Promise<CalendarLinkRow> {
  requirePermission(ctx, 'calendar.manage')
  return db.transaction(async tx => {
    const [link] = await tx
      .insert(calendarLinks)
      .values({ householdId: ctx.householdId, userId: ctx.userId, ...input })
      .onConflictDoUpdate({
        target: [calendarLinks.userId, calendarLinks.provider, calendarLinks.calendarId],
        set: {
          accountEmail: input.accountEmail,
          refreshTokenEncrypted: input.refreshTokenEncrypted,
          status: 'active',
          lastError: null,
          updatedAt: sql`now()`,
        },
        setWhere: eq(calendarLinks.householdId, ctx.householdId),
      })
      .returning(linkColumns)
    if (!link) throw new ConflictError('That calendar is linked to another household.')
    await recordAudit(ctx, tx, {
      action: 'calendar_link.connected',
      entity: 'calendar_link',
      entityId: link.id,
      metadata: { provider: input.provider },
    })
    return link
  })
}

/**
 * Unlinks a calendar and removes the events it synced. People unlink their own; an owner can also
 * unlink anyone's. Returns the encrypted token so the caller can revoke it with the provider.
 */
export async function deleteCalendarLink(
  ctx: RequestContext,
  db: Db,
  input: { linkId: string }
): Promise<{ refreshTokenEncrypted: string }> {
  requirePermission(ctx, 'calendar.manage')
  return db.transaction(async tx => {
    const [link] = await tx
      .select({ userId: calendarLinks.userId, provider: calendarLinks.provider })
      .from(calendarLinks)
      .where(linkKey(ctx, input.linkId))
      .for('update')
    if (!link) throw new NotFoundError(LINK_NOT_FOUND)
    if (link.userId !== ctx.userId) requirePermission(ctx, 'connections.manage')

    const [deleted] = await tx
      .delete(calendarLinks)
      .where(linkKey(ctx, input.linkId))
      .returning({ refreshTokenEncrypted: calendarLinks.refreshTokenEncrypted })
    if (!deleted) throw new NotFoundError(LINK_NOT_FOUND)
    await recordAudit(ctx, tx, {
      action: 'calendar_link.removed',
      entity: 'calendar_link',
      entityId: input.linkId,
      metadata: { provider: link.provider, ownLink: link.userId === ctx.userId },
    })
    return deleted
  })
}

export interface CalendarLinkCredentials {
  id: string
  userId: string
  provider: CalendarProvider
  calendarId: string
  direction: LinkDirection
  status: LinkStatus
  syncToken: string | null
  /** Decrypt only to call the provider. Never log it or put it in a response. */
  refreshTokenEncrypted: string
}

/** What a sync needs to call the provider for one link. */
export async function getCalendarLinkCredentials(actor: Actor, db: Db, input: { linkId: string }): Promise<CalendarLinkCredentials> {
  authorize(actor, 'calendar.manage')
  const [link] = await db
    .select({
      id: calendarLinks.id,
      userId: calendarLinks.userId,
      provider: calendarLinks.provider,
      calendarId: calendarLinks.calendarId,
      direction: calendarLinks.direction,
      status: calendarLinks.status,
      syncToken: calendarLinks.syncToken,
      refreshTokenEncrypted: calendarLinks.refreshTokenEncrypted,
    })
    .from(calendarLinks)
    .where(linkKey(actor, input.linkId))
    .limit(1)
  if (!link) throw new NotFoundError(LINK_NOT_FOUND)
  return link
}

/**
 * Records a failed sync. `needs_reconnect` stops syncing the link until its owner connects again;
 * `error` is retried next time. `lastError` is our own wording, never a provider's response.
 */
export async function setCalendarLinkState(
  actor: Actor,
  db: Db,
  input: { linkId: string; status: LinkStatus; lastError: string | null }
): Promise<void> {
  authorize(actor, 'calendar.manage')
  await db.transaction(async tx => {
    const [link] = await tx
      .update(calendarLinks)
      .set({
        status: input.status,
        lastError: input.lastError?.slice(0, LAST_ERROR_MAX_LENGTH) ?? null,
        updatedAt: sql`now()`,
      })
      .where(linkKey(actor, input.linkId))
      .returning({ id: calendarLinks.id })
    if (!link) throw new NotFoundError(LINK_NOT_FOUND)
    if (input.status === 'needs_reconnect') {
      await recordAudit(actor, tx, {
        action: 'calendar_link.needs_reconnect',
        entity: 'calendar_link',
        entityId: input.linkId,
      })
    }
  })
}

/**
 * Drops a sync token the provider no longer accepts (410 GONE), so the next sync is a full one.
 * Does nothing if another sync already moved the token on. Returns whether it cleared it.
 */
export async function clearCalendarSyncToken(actor: Actor, db: Db, input: { linkId: string; expectedSyncToken: string }): Promise<boolean> {
  authorize(actor, 'calendar.manage')
  const cleared = await db
    .update(calendarLinks)
    .set({ syncToken: null, updatedAt: sql`now()` })
    .where(and(linkKey(actor, input.linkId), eq(calendarLinks.syncToken, input.expectedSyncToken)))
    .returning({ id: calendarLinks.id })
  return cleared.length > 0
}

export interface CalendarSyncWrite {
  linkId: string
  /** The token this sync started from, or null for a full sync. */
  expectedSyncToken: string | null
  plan: InboundSyncPlan
  nextSyncToken: string
  /** When this sync started. Every row it writes is stamped with it. */
  syncedAt: Date
  /**
   * For a full sync, where the provider's listing began. Synced rows that end before it are kept
   * as history; later rows the listing didn't include are removed.
   */
  fullSyncFrom: Date | null
}

const SYNC_CHUNK_SIZE = 500

/**
 * Applies one sync's changes and moves the link's token on, all or nothing. If the token moved
 * since the sync started, someone else synced first: it writes nothing and throws ConflictError.
 * Upserts key on (link, provider event id), so running the same sync twice changes nothing.
 */
export async function applyCalendarSync(actor: Actor, db: Db, input: CalendarSyncWrite): Promise<{ upserted: number; removed: number }> {
  authorize(actor, 'calendar.manage')
  return db.transaction(async tx => {
    const [link] = await tx
      .select({
        id: calendarLinks.id,
        userId: calendarLinks.userId,
        provider: calendarLinks.provider,
        calendarId: calendarLinks.calendarId,
        syncToken: calendarLinks.syncToken,
      })
      .from(calendarLinks)
      .where(linkKey(actor, input.linkId))
      .for('update')
    if (!link) throw new NotFoundError(LINK_NOT_FOUND)
    if (link.syncToken !== input.expectedSyncToken) {
      throw new ConflictError('This calendar was synced by another run at the same time.')
    }

    for (const chunk of chunks(input.plan.upserts, SYNC_CHUNK_SIZE)) {
      await tx
        .insert(events)
        .values(
          chunk.map(change => {
            const event = normalizeExternalEvent(change)
            return {
              householdId: actor.householdId,
              title: event.title,
              description: event.description,
              location: event.location,
              startsAt: event.startsAt,
              endsAt: event.endsAt,
              allDay: event.allDay,
              category: 'personal' as const,
              createdBy: link.userId,
              externalSource: link.provider,
              externalId: event.externalId,
              externalCalendarId: link.calendarId,
              calendarLinkId: link.id,
              lastSyncedAt: input.syncedAt,
            }
          })
        )
        .onConflictDoUpdate({
          target: [events.calendarLinkId, events.externalId],
          targetWhere: sql`${events.externalId} is not null`,
          set: {
            title: sql`excluded.title`,
            description: sql`excluded.description`,
            location: sql`excluded.location`,
            startsAt: sql`excluded.starts_at`,
            endsAt: sql`excluded.ends_at`,
            allDay: sql`excluded.all_day`,
            lastSyncedAt: sql`excluded.last_synced_at`,
            updatedAt: sql`now()`,
          },
        })
    }

    let removed = 0
    for (const chunk of chunks(input.plan.removedIds, SYNC_CHUNK_SIZE)) {
      const rows = await tx
        .delete(events)
        .where(and(eq(events.calendarLinkId, link.id), inArray(events.externalId, chunk)))
        .returning({ id: events.id })
      removed += rows.length
    }
    if (input.plan.replaceAll) {
      // Stale means "not in the listing", decided by id. A timestamp sweep would keep deleted events
      // whenever this run's clock read no later than the last run's.
      const listed = new Set(input.plan.upserts.map(event => event.externalId))
      const existing = await tx
        .select({ id: events.id, externalId: events.externalId })
        .from(events)
        .where(and(eq(events.calendarLinkId, link.id), input.fullSyncFrom ? sql`${events.endsAt} >= ${input.fullSyncFrom}` : undefined))
      const stale = existing.filter(row => row.externalId === null || !listed.has(row.externalId)).map(row => row.id)
      for (const chunk of chunks(stale, SYNC_CHUNK_SIZE)) {
        const rows = await tx.delete(events).where(inArray(events.id, chunk)).returning({ id: events.id })
        removed += rows.length
      }
    }

    await tx
      .update(calendarLinks)
      .set({
        syncToken: input.nextSyncToken,
        lastSyncedAt: input.syncedAt,
        status: 'active',
        lastError: null,
        updatedAt: sql`now()`,
      })
      .where(eq(calendarLinks.id, link.id))

    return { upserted: input.plan.upserts.length, removed }
  })
}

export interface CalendarLinkSyncTarget {
  id: string
  householdId: string
}

/**
 * Links the daily sync should visit, across every household, least recently synced first. Links
 * that need reconnecting are skipped: nothing will work until their owner signs in again.
 */
export async function listCalendarLinksForSync(db: Db): Promise<CalendarLinkSyncTarget[]> {
  return db
    .select({ id: calendarLinks.id, householdId: calendarLinks.householdId })
    .from(calendarLinks)
    .where(ne(calendarLinks.status, 'needs_reconnect'))
    .orderBy(sql`${calendarLinks.lastSyncedAt} asc nulls first`, asc(calendarLinks.id))
}

/** A household's links a manual "Sync now" should visit. */
export async function listHouseholdCalendarLinksForSync(ctx: RequestContext, db: Db): Promise<CalendarLinkSyncTarget[]> {
  requirePermission(ctx, 'calendar.manage')
  return db
    .select({ id: calendarLinks.id, householdId: calendarLinks.householdId })
    .from(calendarLinks)
    .where(and(eq(calendarLinks.householdId, ctx.householdId), ne(calendarLinks.status, 'needs_reconnect')))
    .orderBy(asc(calendarLinks.createdAt), asc(calendarLinks.id))
}

// ---------------------------------------------------------------------------------------------
// Derived sources

/**
 * Bookings that may put something on the calendar in a range of days. Loose by a day at each
 * end, since flight times are instants; the feed places each item on the household's days.
 */
export async function listTripBookingsInRange(ctx: RequestContext, db: Db, range: DateRange): Promise<TripBooking[]> {
  requirePermission(ctx, 'travel.view')
  const from = addCalendarDays(range.from, -1)
  const to = addCalendarDays(range.to, 1)
  const utcDate = (column: typeof bookings.departAt | typeof bookings.returnAt) => sql`(${column} at time zone 'UTC')::date`
  return db
    .select({
      id: bookings.id,
      kind: bookings.kind,
      status: bookings.status,
      origin: bookings.origin,
      destination: bookings.destination,
      propertyName: bookings.propertyName,
      providerName: bookings.providerName,
      checkIn: bookings.checkIn,
      checkOut: bookings.checkOut,
      departAt: bookings.departAt,
      returnAt: bookings.returnAt,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.householdId, ctx.householdId),
        ne(bookings.status, 'cancelled'),
        sql`coalesce(${bookings.checkIn}, ${utcDate(bookings.departAt)}) <= ${to}::date`,
        sql`coalesce(${bookings.checkOut}, ${utcDate(bookings.returnAt)}, ${utcDate(bookings.departAt)}) >= ${from}::date`
      )
    )
    .orderBy(asc(bookings.id))
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}
