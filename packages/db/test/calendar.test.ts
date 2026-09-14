import type { PGlite } from '@electric-sql/pglite'
import type { RequestContext } from '@ghar/contracts'
import { allDayRange, planInboundSync, type EventFields, type ExternalEvent, type ExternalEventChange } from '@ghar/core/calendar'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@ghar/core/errors'
import { invitationExpiresAt } from '@ghar/core/invitations'
import type { BookingFields } from '@ghar/core/travel'
import { asc, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { events } from '../src/schema'
import {
  applyCalendarSync,
  clearCalendarSyncToken,
  createEvent,
  deleteCalendarLink,
  deleteEvent,
  getCalendarLinkCredentials,
  getEvent,
  listCalendarLinks,
  listCalendarLinksForSync,
  listEventsInWindow,
  listHouseholdCalendarLinksForSync,
  listTripBookingsInRange,
  respondToEvent,
  setCalendarLinkState,
  updateEvent,
  upsertCalendarLink,
} from '../src/queries/calendar'
import { createInvitation } from '../src/queries/invitations'
import { removeMember } from '../src/queries/members'
import { acceptInvitation, createHousehold } from '../src/queries/session'
import { createBooking } from '../src/queries/travel'
import type { Db, SystemContext } from '../src/queries/types'
import { createAuthUser, createTestDatabase, queryAs } from './support/database'

const now = new Date('2026-09-13T15:00:00Z')
/** September in America/Chicago, household A's zone. */
const september = {
  start: new Date('2026-09-01T05:00:00Z'),
  end: new Date('2026-10-01T05:00:00Z'),
}

let client: PGlite
let db: Db
const users = { ownerA: '', memberA: '', viewerA: '', ownerB: '' }
let a: RequestContext
let member: RequestContext
let viewer: RequestContext
let b: RequestContext

function system(ctx: RequestContext): SystemContext {
  return { householdId: ctx.householdId, userId: null }
}

function dinner(overrides: Partial<EventFields> = {}): EventFields {
  return {
    title: ' Family dinner ',
    description: null,
    location: null,
    startsAt: new Date('2026-09-20T23:00:00Z'),
    endsAt: new Date('2026-09-21T01:00:00Z'),
    allDay: false,
    rrule: null,
    category: 'household',
    colorToken: null,
    ...overrides,
  }
}

function external(externalId: string, overrides: Partial<ExternalEvent> = {}): ExternalEventChange {
  return {
    kind: 'upsert',
    externalId,
    title: `Google ${externalId}`,
    description: null,
    location: null,
    startsAt: new Date('2026-09-15T14:00:00Z'),
    endsAt: new Date('2026-09-15T15:00:00Z'),
    allDay: false,
    ...overrides,
  }
}

function hotel(overrides: Partial<BookingFields> = {}): BookingFields {
  return {
    kind: 'hotel',
    status: 'booked',
    confirmationCode: null,
    providerName: null,
    carrier: null,
    cabin: null,
    ratePlan: 'pay_at_property',
    refundable: true,
    origin: null,
    destination: 'Los Angeles',
    propertyName: 'Hotel Figueroa',
    checkIn: '2026-09-18',
    checkOut: '2026-09-20',
    departAt: null,
    returnAt: null,
    travelers: 2,
    paidCents: 90_000,
    currency: 'USD',
    watchEnabled: false,
    ...overrides,
  }
}

async function link(ctx: RequestContext, calendarId: string, token = 'v1.iv.tag.ciphertext') {
  return upsertCalendarLink(ctx, db, {
    provider: 'google',
    accountEmail: 'calendar@example.com',
    calendarId,
    refreshTokenEncrypted: token,
  })
}

/** A first, full sync of the given events. */
async function fullSync(ctx: RequestContext, linkId: string, changes: ExternalEventChange[]) {
  return applyCalendarSync(system(ctx), db, {
    linkId,
    expectedSyncToken: null,
    plan: planInboundSync(changes, { fullSync: true }),
    nextSyncToken: 'token-1',
    syncedAt: now,
    fullSyncFrom: null,
  })
}

async function syncedRows(linkId: string) {
  return db.select().from(events).where(eq(events.calendarLinkId, linkId)).orderBy(asc(events.externalId))
}

async function join(email: string, role: 'member' | 'viewer', tokenHash: string): Promise<string> {
  const userId = await createAuthUser(client, email)
  await createInvitation(a, db, { email, role, tokenHash, expiresAt: invitationExpiresAt(now) })
  await acceptInvitation({ userId, email }, db, { tokenHash, now })
  return userId
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  users.ownerA = await createAuthUser(client, 'owner-a@example.com')
  users.ownerB = await createAuthUser(client, 'owner-b@example.com')

  const householdA = await createHousehold({ userId: users.ownerA, email: 'owner-a@example.com' }, db, {
    name: 'Household A',
    timezone: 'America/Chicago',
    currency: 'USD',
  })
  a = { userId: users.ownerA, householdId: householdA.household.id, role: 'owner' }

  const householdB = await createHousehold({ userId: users.ownerB, email: 'owner-b@example.com' }, db, {
    name: 'Household B',
    timezone: 'UTC',
    currency: 'USD',
  })
  b = { userId: users.ownerB, householdId: householdB.household.id, role: 'owner' }

  users.memberA = await join('member-a@example.com', 'member', 'hash-member-a')
  member = { userId: users.memberA, householdId: a.householdId, role: 'member' }
  users.viewerA = await join('viewer-a@example.com', 'viewer', 'hash-viewer-a')
  viewer = { userId: users.viewerA, householdId: a.householdId, role: 'viewer' }
})

describe('events', () => {
  it('creates an event tidied, with household members on it', async () => {
    const event = await createEvent(member, db, {
      ...dinner(),
      attendeeIds: [users.ownerA, users.memberA, users.ownerA],
    })
    expect(event).toMatchObject({
      title: 'Family dinner',
      createdBy: users.memberA,
      externalSource: null,
      calendarLinkId: null,
    })
    expect(new Set(event.attendees.map(attendee => attendee.userId))).toEqual(new Set([users.ownerA, users.memberA]))
    expect(event.attendees.every(attendee => attendee.response === 'needs_action')).toBe(true)
    expect(await getEvent(viewer, db, { eventId: event.id })).toEqual(event)
  })

  it('refuses outsiders as attendees, viewers as editors, and invalid events', async () => {
    await expect(createEvent(a, db, { ...dinner(), attendeeIds: [users.ownerB] })).rejects.toThrow(ValidationError)
    await expect(createEvent(viewer, db, dinner())).rejects.toThrow(ForbiddenError)
    await expect(createEvent(a, db, dinner({ allDay: true }))).rejects.toThrow(ValidationError)
  })

  it('lists one-off events in the window and repeats that began before it', async () => {
    const inside = await createEvent(a, db, dinner())
    const august = await createEvent(
      a,
      db,
      dinner({
        title: 'August',
        startsAt: new Date('2026-08-10T23:00:00Z'),
        endsAt: new Date('2026-08-11T01:00:00Z'),
      })
    )
    const weekly = await createEvent(
      a,
      db,
      dinner({
        title: 'Piano',
        startsAt: new Date('2026-01-07T23:00:00Z'),
        endsAt: new Date('2026-01-08T00:00:00Z'),
        rrule: 'FREQ=WEEKLY',
      })
    )
    const overnight = await createEvent(
      a,
      db,
      dinner({
        title: 'Overnight',
        startsAt: new Date('2026-08-31T20:00:00Z'),
        endsAt: new Date('2026-09-01T12:00:00Z'),
      })
    )
    const holiday = await createEvent(a, db, dinner({ title: 'Labor Day', allDay: true, ...allDayRange('2026-09-07', '2026-09-07') }))

    const ids = (await listEventsInWindow(a, db, september)).map(event => event.id)
    expect(ids).toEqual(expect.arrayContaining([inside.id, weekly.id, overnight.id, holiday.id]))
    expect(ids).not.toContain(august.id)

    const theirs = (await listEventsInWindow(b, db, september)).map(event => event.id)
    expect(theirs).not.toContain(inside.id)
    await expect(getEvent(b, db, { eventId: inside.id })).rejects.toThrow(NotFoundError)
    await expect(updateEvent(b, db, { ...dinner(), eventId: inside.id })).rejects.toThrow(NotFoundError)
    await expect(deleteEvent(b, db, { eventId: inside.id })).rejects.toThrow(NotFoundError)
  })

  it('keeps answers when attendees change, and lets people answer for themselves', async () => {
    const event = await createEvent(a, db, {
      ...dinner(),
      attendeeIds: [users.ownerA, users.memberA],
    })
    await respondToEvent(member, db, { eventId: event.id, response: 'accepted' })

    const updated = await updateEvent(a, db, {
      ...dinner({ title: 'Dinner at seven' }),
      eventId: event.id,
      attendeeIds: [users.memberA, users.viewerA],
    })
    expect(updated.title).toBe('Dinner at seven')
    expect(new Map(updated.attendees.map(row => [row.userId, row.response]))).toEqual(
      new Map([
        [users.memberA, 'accepted'],
        [users.viewerA, 'needs_action'],
      ])
    )

    const untouched = await updateEvent(a, db, { ...dinner(), eventId: event.id })
    expect(untouched.attendees).toHaveLength(2)

    await expect(respondToEvent(a, db, { eventId: event.id, response: 'declined' })).rejects.toThrow(NotFoundError)
    const answered = await respondToEvent(viewer, db, { eventId: event.id, response: 'tentative' })
    expect(answered.attendees.find(row => row.userId === users.viewerA)?.response).toBe('tentative')

    const cleared = await updateEvent(a, db, { ...dinner(), eventId: event.id, attendeeIds: [] })
    expect(cleared.attendees).toEqual([])
  })

  it('deletes a whole series', async () => {
    const weekly = await createEvent(a, db, dinner({ rrule: 'FREQ=WEEKLY;COUNT=10' }))
    await deleteEvent(member, db, { eventId: weekly.id })
    await expect(getEvent(a, db, { eventId: weekly.id })).rejects.toThrow(NotFoundError)
  })

  it('holds all-day rows to whole UTC days in the database too', async () => {
    await expect(
      db.insert(events).values({
        householdId: a.householdId,
        title: 'Misaligned',
        startsAt: new Date('2026-09-01T05:00:00Z'),
        endsAt: new Date('2026-09-02T05:00:00Z'),
        allDay: true,
      })
    ).rejects.toThrow()
  })
})

describe('linked calendars', () => {
  it('links a person’s own calendar and never lists its token', async () => {
    const linked = await link(member, 'member-primary')
    expect(linked).toMatchObject({
      userId: users.memberA,
      provider: 'google',
      direction: 'inbound',
      status: 'active',
      lastSyncedAt: null,
    })

    const listed = await listCalendarLinks(viewer, db)
    expect(listed.map(row => row.id)).toContain(linked.id)
    for (const row of listed) {
      expect(row).not.toHaveProperty('refreshTokenEncrypted')
      expect(row).not.toHaveProperty('syncToken')
    }
    expect(await listCalendarLinks(b, db)).toEqual([])
    await expect(link(viewer, 'viewer-primary')).rejects.toThrow(ForbiddenError)
  })

  it('stops syncing a link that needs reconnecting, and reconnecting resumes it', async () => {
    const first = await link(a, 'reconnect')
    await setCalendarLinkState(system(a), db, {
      linkId: first.id,
      status: 'needs_reconnect',
      lastError: 'Google stopped accepting this sign-in.',
    })
    expect((await listCalendarLinksForSync(db)).map(row => row.id)).not.toContain(first.id)
    expect((await listHouseholdCalendarLinksForSync(a, db)).map(row => row.id)).not.toContain(first.id)
    expect((await listCalendarLinks(a, db)).find(row => row.id === first.id)).toMatchObject({
      status: 'needs_reconnect',
      lastError: 'Google stopped accepting this sign-in.',
    })

    const again = await link(a, 'reconnect', 'v1.new.token.value')
    expect(again).toMatchObject({ id: first.id, status: 'active', lastError: null })
    const credentials = await getCalendarLinkCredentials(system(a), db, { linkId: first.id })
    expect(credentials.refreshTokenEncrypted).toBe('v1.new.token.value')
    expect((await listCalendarLinksForSync(db)).map(row => row.id)).toContain(first.id)
  })

  it('lets people unlink their own calendar, and owners unlink anyone’s', async () => {
    const owners = await link(a, 'owner-unlink')
    const members = await link(member, 'member-unlink')
    await fullSync(member, members.id, [external('unlink-1')])

    await expect(deleteCalendarLink(member, db, { linkId: owners.id })).rejects.toThrow(ForbiddenError)
    await expect(deleteCalendarLink(b, db, { linkId: members.id })).rejects.toThrow(NotFoundError)
    expect(await deleteCalendarLink(a, db, { linkId: members.id })).toEqual({
      refreshTokenEncrypted: 'v1.iv.tag.ciphertext',
    })
    expect(await syncedRows(members.id)).toEqual([])
    await deleteCalendarLink(a, db, { linkId: owners.id })
  })

  it('removes a leaving member’s link and the events it synced', async () => {
    const leaverId = await join('leaver-a@example.com', 'member', 'hash-leaver-a')
    const leaver: RequestContext = { userId: leaverId, householdId: a.householdId, role: 'member' }
    const theirs = await link(leaver, 'leaver')
    await fullSync(leaver, theirs.id, [external('leaver-1')])

    await removeMember(a, db, { userId: leaverId })
    expect((await listCalendarLinks(a, db)).map(row => row.id)).not.toContain(theirs.id)
    expect(await syncedRows(theirs.id)).toEqual([])
  })
})

describe('applyCalendarSync', () => {
  it('keys rows on the provider’s id, so repeating a sync adds nothing', async () => {
    const target = await link(a, 'idempotent')
    const changes = [external('g1'), external('g2', { allDay: true, ...allDayRange('2026-09-16', '2026-09-17') })]
    expect(await fullSync(a, target.id, changes)).toEqual({ upserted: 2, removed: 0 })
    await applyCalendarSync(system(a), db, {
      linkId: target.id,
      expectedSyncToken: 'token-1',
      plan: planInboundSync(changes, { fullSync: false }),
      nextSyncToken: 'token-2',
      syncedAt: new Date('2026-09-13T16:00:00Z'),
      fullSyncFrom: null,
    })

    const rows = await syncedRows(target.id)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      externalId: 'g1',
      externalSource: 'google',
      externalCalendarId: 'idempotent',
      category: 'personal',
      createdBy: users.ownerA,
      rrule: null,
    })
    expect((await listEventsInWindow(member, db, september)).map(row => row.id)).toEqual(expect.arrayContaining(rows.map(row => row.id)))
    expect(await listCalendarLinks(a, db)).toContainEqual(
      expect.objectContaining({ id: target.id, lastSyncedAt: new Date('2026-09-13T16:00:00Z') })
    )
  })

  it('won’t let anyone edit or delete a synced event here', async () => {
    const target = await link(a, 'read-only')
    await fullSync(a, target.id, [external('locked')])
    const [row] = await syncedRows(target.id)
    if (!row) throw new Error('sync wrote no row')
    await expect(updateEvent(a, db, { ...dinner(), eventId: row.id })).rejects.toThrow(ForbiddenError)
    await expect(deleteEvent(a, db, { eventId: row.id })).rejects.toThrow(ForbiddenError)
  })

  it('applies changes and removals incrementally', async () => {
    const target = await link(a, 'incremental')
    await fullSync(a, target.id, [external('g1'), external('g2')])
    const result = await applyCalendarSync(system(a), db, {
      linkId: target.id,
      expectedSyncToken: 'token-1',
      plan: planInboundSync([external('g1', { title: 'Renamed' }), { kind: 'removed', externalId: 'g2' }], { fullSync: false }),
      nextSyncToken: 'token-2',
      syncedAt: new Date('2026-09-14T15:00:00Z'),
      fullSyncFrom: null,
    })
    expect(result).toEqual({ upserted: 1, removed: 1 })
    expect((await syncedRows(target.id)).map(row => [row.externalId, row.title])).toEqual([['g1', 'Renamed']])
    const credentials = await getCalendarLinkCredentials(system(a), db, { linkId: target.id })
    expect(credentials.syncToken).toBe('token-2')
  })

  it('refuses a sync that started from a token another run already replaced', async () => {
    const target = await link(a, 'stale')
    await fullSync(a, target.id, [external('g1')])
    await expect(fullSync(a, target.id, [])).rejects.toThrow(ConflictError)
    expect(await syncedRows(target.id)).toHaveLength(1)

    const clear = (expectedSyncToken: string) => clearCalendarSyncToken(system(a), db, { linkId: target.id, expectedSyncToken })
    expect(await clear('someone-elses')).toBe(false)
    expect(await clear('token-1')).toBe(true)
    expect((await getCalendarLinkCredentials(system(a), db, { linkId: target.id })).syncToken).toBe(null)
  })

  it('after a 410, a full resync removes what’s gone but keeps older history', async () => {
    const target = await link(a, 'resync')
    await fullSync(a, target.id, [
      external('old', {
        startsAt: new Date('2026-03-01T14:00:00Z'),
        endsAt: new Date('2026-03-01T15:00:00Z'),
      }),
      external('keep'),
      external('gone'),
    ])

    expect(
      await clearCalendarSyncToken(system(a), db, {
        linkId: target.id,
        expectedSyncToken: 'token-1',
      })
    ).toBe(true)
    const result = await applyCalendarSync(system(a), db, {
      linkId: target.id,
      expectedSyncToken: null,
      plan: planInboundSync([external('keep', { title: 'Kept' })], { fullSync: true }),
      nextSyncToken: 'token-2',
      syncedAt: new Date('2026-09-14T15:00:00Z'),
      fullSyncFrom: new Date('2026-06-16T15:00:00Z'),
    })
    expect(result).toEqual({ upserted: 1, removed: 1 })
    expect((await syncedRows(target.id)).map(row => [row.externalId, row.title])).toEqual([
      ['keep', 'Kept'],
      ['old', 'Google old'],
    ])
  })

  it('is only reachable within the link’s household', async () => {
    const target = await link(a, 'scoped')
    await expect(fullSync(b, target.id, [external('intruder')])).rejects.toThrow(NotFoundError)
    await expect(getCalendarLinkCredentials(system(b), db, { linkId: target.id })).rejects.toThrow(NotFoundError)
    await expect(setCalendarLinkState(system(b), db, { linkId: target.id, status: 'error', lastError: null })).rejects.toThrow(
      NotFoundError
    )
  })
})

describe('trip bookings for the calendar', () => {
  it('finds bookings that touch the range, leaving out cancelled ones', async () => {
    const stay = await createBooking(a, db, hotel())
    const later = await createBooking(a, db, hotel({ checkIn: '2026-11-01', checkOut: '2026-11-03' }))
    const cancelled = await createBooking(a, db, hotel({ status: 'cancelled' }))

    const ids = (await listTripBookingsInRange(viewer, db, { from: '2026-09-01', to: '2026-09-30' })).map(row => row.id)
    expect(ids).toContain(stay.id)
    expect(ids).not.toContain(later.id)
    expect(ids).not.toContain(cancelled.id)
    expect(await listTripBookingsInRange(b, db, { from: '2026-09-01', to: '2026-09-30' })).toEqual([])
  })
})

describe('row-level security', () => {
  const count = async (userId: string, table: string) => {
    const [row] = await queryAs<{ count: number }>(client, userId, `select count(*)::int as count from ${table}`)
    return row?.count
  }

  it('lets members read their household’s events and attendees, and nobody read links', async () => {
    expect(await count(users.memberA, 'events')).toBeGreaterThan(0)
    expect(await count(users.memberA, 'event_attendees')).toBeGreaterThan(0)
    expect(await count(users.ownerB, 'events')).toBe(0)
    expect(await count(users.ownerB, 'event_attendees')).toBe(0)
    expect(await count(users.ownerA, 'calendar_links')).toBe(0)
  })
})
