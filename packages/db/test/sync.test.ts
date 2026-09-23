import type { PGlite } from '@electric-sql/pglite'
import { documentStoragePath } from '@ghar/core/documents'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { SYNC_ENTITIES, type SyncEntity } from '@ghar/core/sync'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { createContact, deleteContact, type ContactInput } from '../src/queries/contacts'
import { setDigestPreferences } from '../src/queries/digest'
import { createDocument } from '../src/queries/documents'
import { createInvitation } from '../src/queries/invitations'
import { createOption, createSlot, voteOnOption } from '../src/queries/itinerary'
import { createBookingDraft } from '../src/queries/mail'
import { removeMember } from '../src/queries/members'
import { acceptInvitation, createHousehold } from '../src/queries/session'
import {
  canSyncEntity,
  getSyncClock,
  readSyncEntity,
  readSyncTombstones,
  type SyncItem,
  type SyncRows,
  type SyncWindow,
} from '../src/queries/sync'
import { createTrip } from '../src/queries/trips'
import type { Db, RequestContext } from '../src/queries/types'
import { bookingDrafts } from '../src/schema'
import { createAuthUser, createTestDatabase } from './support/database'

// The keyset reads behind GET /api/v1/sync. The walk across entities is tested in apps/web.

let client: PGlite
let db: Db
let owner: RequestContext
let adult: RequestContext
let member: RequestContext
let viewer: RequestContext

async function invite(householdOwner: RequestContext, userId: string, email: string, role: 'adult' | 'member' | 'viewer'): Promise<RequestContext> {
  const now = new Date()
  const tokenHash = `hash-${email}-${String(now.getTime())}`
  await createInvitation(householdOwner, db, { email, role, tokenHash, expiresAt: invitationExpiresAt(now) })
  await acceptInvitation({ userId, email }, db, { tokenHash, now })
  return { userId, householdId: householdOwner.householdId, role }
}

async function join(householdOwner: RequestContext, email: string, role: 'adult' | 'member' | 'viewer'): Promise<RequestContext> {
  return invite(householdOwner, await createAuthUser(client, email), email, role)
}

const contact = (name: string): ContactInput => ({ name, role: null, phone: null, email: null, url: null, notes: null, tags: [] })

const trip = {
  name: 'Lisbon',
  destination: 'Lisbon',
  startsOn: '2026-10-01',
  endsOn: '2026-10-05',
  status: 'planned',
  coverImageUrl: null,
  budgetCents: null,
  notes: null,
  travellerIds: [],
} as const

const slot = {
  day: '2026-10-01',
  band: 'evening',
  kind: 'meal',
  label: 'Dinner',
  startsAt: null,
  endsAt: null,
  decideBy: null,
  notes: null,
} as const

const document = (title: string, isSensitive: boolean) => ({
  title,
  kind: 'id' as const,
  issuedOn: null,
  expiresOn: null,
  issuer: null,
  referenceNumber: null,
  assetId: null,
  personId: null,
  notes: null,
  isSensitive,
  storagePath: documentStoragePath(owner.householdId, crypto.randomUUID(), 'application/pdf'),
  mimeType: 'application/pdf' as const,
  sizeBytes: 1024,
})

const draft = (userId: string, messageId: string) => ({
  userId,
  messageId,
  receivedAt: new Date(),
  senderDomain: 'example.com',
  subject: 'Your booking',
  rawExtract: {},
})

async function syncWindow(ctx: RequestContext, overrides: Partial<SyncWindow> = {}): Promise<SyncWindow> {
  return { floor: null, snapshotAt: await getSyncClock(ctx, db), after: null, limit: 1000, ...overrides }
}

/**
 * The database clock, then a short wait so the next write is stamped after it. PGlite's clock can hand
 * out the same stamp twice in a row; real Postgres counts microseconds.
 */
async function mark(ctx: RequestContext): Promise<string> {
  const at = await getSyncClock(ctx, db)
  await new Promise(resolve => setTimeout(resolve, 5))
  return at
}

/** Every item in the window, `pageSize` at a time, each page resuming from the last one's final key. */
async function readAll<E extends SyncEntity>(ctx: RequestContext, entity: E, window: SyncWindow, pageSize: number) {
  const items: SyncItem<SyncRows[E]>[] = []
  let after = window.after
  for (let pages = 0; pages < 100; pages += 1) {
    const page = await readSyncEntity(ctx, db, entity, { ...window, after, limit: pageSize })
    items.push(...page)
    if (page.length < pageSize) return items
    after = page.at(-1)?.key ?? null
  }
  throw new Error('The read never finished')
}

const STAMP_SQL = `to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  const ownerId = await createAuthUser(client, 'sync-owner@example.com')
  const { household } = await createHousehold({ userId: ownerId, email: 'sync-owner@example.com' }, db, {
    name: 'Home',
    timezone: 'America/Chicago',
    currency: 'USD',
  })
  owner = { userId: ownerId, householdId: household.id, role: 'owner' }
  adult = await join(owner, 'sync-adult@example.com', 'adult')
  member = await join(owner, 'sync-member@example.com', 'member')
  viewer = await join(owner, 'sync-viewer@example.com', 'viewer')
}, 60_000)

describe('readSyncEntity', () => {
  it('reads every row once, oldest change first, across pages', async () => {
    for (const name of ['Plumber', 'Electrician', 'Roofer', 'Gardener', 'Locksmith']) await createContact(owner, db, contact(name))

    const items = await readAll(owner, 'contact', await syncWindow(owner), 2)

    const { rows } = await client.query<{ id: string; at: string }>(
      `select id, ${STAMP_SQL} as at from contacts where household_id = $1 order by updated_at, id`,
      [owner.householdId]
    )
    expect(rows.length).toBeGreaterThanOrEqual(5)
    expect(items.map(item => ({ id: item.key.id, at: item.key.at }))).toEqual(rows)
    expect(items.every(item => item.kind === 'change')).toBe(true)
  })

  it('keeps to the window', async () => {
    const snapshotAt = await getSyncClock(owner, db)
    // PGlite's clock can hand out the same stamp twice in a row; real Postgres counts microseconds.
    await new Promise(resolve => setTimeout(resolve, 5))
    const later = await createContact(owner, db, contact('After the snapshot'))

    const upToSnapshot = await readSyncEntity(owner, db, 'contact', await syncWindow(owner, { snapshotAt }))
    expect(upToSnapshot.map(item => item.key.id)).not.toContain(later.id)

    const sinceSnapshot = await readSyncEntity(owner, db, 'contact', await syncWindow(owner, { floor: snapshotAt }))
    expect(sinceSnapshot.map(item => item.key.id)).toEqual([later.id])
  })

  it('sends a slot again, with its options and votes, when someone votes', async () => {
    const lisbon = await createTrip(owner, db, trip)
    const dinner = await createSlot(owner, db, lisbon.id, slot)
    const [ramiro] = (await createOption(owner, db, lisbon.id, dinner.id, { title: 'Ramiro' })).options
    if (!ramiro) throw new Error('expected an option')
    const floor = await mark(owner)

    await voteOnOption(member, db, lisbon.id, ramiro.id, { vote: 'yes' })

    const items = await readSyncEntity(owner, db, 'itinerary_slot', await syncWindow(owner, { floor }))
    expect(items).toHaveLength(1)
    const [item] = items
    if (item?.kind !== 'change') throw new Error('expected a change')
    expect(item.row.id).toBe(dinner.id)
    expect(item.row.options.map(option => option.id)).toEqual([ramiro.id])
    expect(item.row.options[0]?.votes.map(vote => vote.userId)).toEqual([member.userId])
  })

  it("reads only the caller's own booking drafts", async () => {
    const adultDraft = await createBookingDraft(adult, db, draft(adult.userId, 'sync-draft-adult'))
    const memberDraft = await createBookingDraft(member, db, draft(member.userId, 'sync-draft-member'))
    if (adultDraft === null || memberDraft === null) throw new Error('expected drafts')

    const forAdult = await readSyncEntity(adult, db, 'booking_draft', await syncWindow(adult))
    expect(forAdult.map(item => item.key.id)).toEqual([adultDraft])
    const forMember = await readSyncEntity(member, db, 'booking_draft', await syncWindow(member))
    expect(forMember.map(item => item.key.id)).toEqual([memberDraft])
    expect((await readSyncEntity(owner, db, 'booking_draft', await syncWindow(owner))).map(item => item.key.id)).toEqual([])

    expect(canSyncEntity('viewer', 'booking_draft')).toBe(false)
    await expect(readSyncEntity(viewer, db, 'booking_draft', await syncWindow(viewer))).rejects.toThrow()
  })

  it('sends a sensitive document to a member only as a delete, and only when catching up', async () => {
    const floor = await mark(owner)
    const passport = await createDocument(owner, db, document('Passport', true))
    const lease = await createDocument(owner, db, document('Lease', false))

    const fullSync = await readSyncEntity(member, db, 'document', await syncWindow(member))
    expect(fullSync.map(item => item.key.id)).toContain(lease.id)
    expect(fullSync.map(item => item.key.id)).not.toContain(passport.id)

    const catchUp = await readSyncEntity(member, db, 'document', await syncWindow(member, { floor }))
    expect(catchUp.map(item => ({ kind: item.kind, id: item.key.id })).toSorted((a, b) => a.kind.localeCompare(b.kind))).toEqual([
      { kind: 'change', id: lease.id },
      { kind: 'delete', id: passport.id },
    ])

    const forOwner = await readSyncEntity(owner, db, 'document', await syncWindow(owner, { floor }))
    expect(forOwner.map(item => item.kind)).toEqual(['change', 'change'])
  })
})

describe('readSyncTombstones', () => {
  it("reads the household's deletes and the caller's own, oldest first", async () => {
    const floor = await mark(owner)
    const gone = await createContact(owner, db, contact('Gone'))
    await deleteContact(owner, db, gone.id)
    const draftId = await createBookingDraft(adult, db, draft(adult.userId, 'sync-draft-deleted'))
    if (draftId === null) throw new Error('expected a draft')
    await db.delete(bookingDrafts).where(eq(bookingDrafts.id, draftId))

    const forOwner = await readSyncTombstones(owner, db, { ...(await syncWindow(owner, { floor })), entities: SYNC_ENTITIES })
    expect(forOwner.map(tombstone => [tombstone.entity, tombstone.entityId])).toEqual([['contact', gone.id]])

    const forAdult = await readSyncTombstones(adult, db, { ...(await syncWindow(adult, { floor })), entities: SYNC_ENTITIES })
    expect(forAdult.map(tombstone => [tombstone.entity, tombstone.entityId])).toEqual([
      ['contact', gone.id],
      ['booking_draft', draftId],
    ])

    const [first, second] = await readSyncTombstones(adult, db, { ...(await syncWindow(adult, { floor, limit: 1 })), entities: SYNC_ENTITIES })
    expect(second).toBeUndefined()
    const rest = await readSyncTombstones(adult, db, {
      ...(await syncWindow(adult, { floor, after: first?.key ?? null })),
      entities: SYNC_ENTITIES,
    })
    expect(rest.map(tombstone => tombstone.entityId)).toEqual([draftId])
  })

  it('leaves out a member who left and came back', async () => {
    const floor = await mark(owner)
    const email = 'sync-returner@example.com'
    const returner = await join(owner, email, 'member')
    await setDigestPreferences(returner, db, { enabled: true, sections: ['bills'], sendHour: 7 })
    await removeMember(owner, db, { userId: returner.userId })

    const whileGone = await readSyncTombstones(owner, db, { ...(await syncWindow(owner, { floor })), entities: SYNC_ENTITIES })
    expect(whileGone.map(tombstone => [tombstone.entity, tombstone.entityId])).toContainEqual(['member', returner.userId])

    await invite(owner, returner.userId, email, 'member')

    const afterReturn = await readSyncTombstones(owner, db, { ...(await syncWindow(owner, { floor })), entities: SYNC_ENTITIES })
    expect(afterReturn.map(tombstone => tombstone.entityId)).not.toContain(returner.userId)
    const members = await readSyncEntity(owner, db, 'member', await syncWindow(owner, { floor }))
    expect(members.map(item => item.key.id)).toContain(returner.userId)
  })
})
