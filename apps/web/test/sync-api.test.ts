import type { PGlite } from '@electric-sql/pglite'
import { syncEntitySchema, syncResponseSchema, type SyncChange, type SyncResponse } from '@ghar/contracts'
import { ValidationError } from '@ghar/core/errors'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { SYNC_ENTITIES } from '@ghar/core/sync'
import {
  acceptInvitation,
  changeMemberRole,
  createContact,
  createHousehold,
  createInvitation,
  deleteContact,
  setDigestPreferences,
  updateContact,
  type ContactInput,
  type Db,
  type RequestContext,
} from '@ghar/db/queries'
import { beforeAll, describe, expect, it } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { readSyncPage } from '@/lib/sync/service'

// The sync walk against a real schema: pages, the snapshot, deletes, and when a client must start over.

let client: PGlite
let db: Db

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
}, 60_000)

let households = 0

interface Home {
  owner: RequestContext
  join: (role: 'adult' | 'member' | 'viewer') => Promise<RequestContext>
}

async function household(): Promise<Home> {
  households += 1
  const n = String(households)
  const email = `sync-owner-${n}@example.com`
  const userId = await createAuthUser(client, email)
  const { household: created } = await createHousehold({ userId, email }, db, { name: `Home ${n}`, timezone: 'America/Chicago', currency: 'USD' })
  const owner: RequestContext = { userId, householdId: created.id, role: 'owner' }
  let joined = 0
  return {
    owner,
    join: async role => {
      joined += 1
      const joinerEmail = `sync-${role}-${n}-${String(joined)}@example.com`
      const joinerId = await createAuthUser(client, joinerEmail)
      const now = new Date()
      const tokenHash = `sync-hash-${joinerEmail}`
      await createInvitation(owner, db, { email: joinerEmail, role, tokenHash, expiresAt: invitationExpiresAt(now) })
      await acceptInvitation({ userId: joinerId, email: joinerEmail }, db, { tokenHash, now })
      return { userId: joinerId, householdId: owner.householdId, role }
    },
  }
}

const contact = (name: string): ContactInput => ({ name, role: null, phone: null, email: null, url: null, notes: null, tags: [] })

function idOf(change: SyncChange): string {
  switch (change.entity) {
    case 'member':
    case 'digest_preferences':
      return change.data.userId
    default:
      return change.data.id
  }
}

const keyOf = (change: SyncChange): string => `${change.entity}:${idOf(change)}`

/** Pages until the walk is done, each checked against the contract as the route would. */
async function walk(ctx: RequestContext, since?: string, limit = 3): Promise<{ pages: SyncResponse[]; nextSince: string }> {
  const pages: SyncResponse[] = []
  let cursor = since
  for (let n = 0; n < 200; n += 1) {
    const page = syncResponseSchema.parse(await readSyncPage(ctx, db, cursor === undefined ? { limit } : { since: cursor, limit }))
    pages.push(page)
    cursor = page.nextSince
    if (!page.hasMore) return { pages, nextSince: page.nextSince }
  }
  throw new Error('The walk never finished')
}

/** Moves a household's contacts two hours back, past the overlap, without the updated_at trigger. */
async function backdateContacts(householdId: string): Promise<void> {
  await client.transaction(async tx => {
    await tx.query('set local session_replication_role = replica')
    await tx.query(`update contacts set updated_at = updated_at - interval '2 hours' where household_id = $1`, [householdId])
  })
}

describe('sync', () => {
  it('lists the same entities as @ghar/core/sync, in order', () => {
    expect(syncEntitySchema.options).toEqual([...SYNC_ENTITIES])
  })

  it('walks everything once, entity by entity, oldest change first', async () => {
    const { owner, join } = await household()
    await join('adult')
    for (const name of ['Plumber', 'Electrician', 'Roofer', 'Gardener', 'Locksmith']) await createContact(owner, db, contact(name))
    const now = new Date()
    await createInvitation(owner, db, { email: 'sync-pending@example.com', role: 'member', tokenHash: 'sync-pending', expiresAt: invitationExpiresAt(now) })
    await setDigestPreferences(owner, db, { enabled: true, sections: ['bills'], sendHour: 7 })

    const { pages } = await walk(owner)

    expect(pages.length).toBeGreaterThan(3)
    for (const page of pages) {
      expect(page.changes.length + page.deletes.length).toBeLessThanOrEqual(3)
      expect(page.resync).toBe(false)
    }
    expect(pages.slice(0, -1).every(page => page.hasMore)).toBe(true)
    expect(pages.flatMap(page => page.deletes)).toEqual([])

    const changes = pages.flatMap(page => page.changes)
    const keys = changes.map(keyOf)
    expect(new Set(keys).size).toBe(keys.length)
    const order = changes.map(change => SYNC_ENTITIES.indexOf(change.entity))
    expect(order).toEqual(order.toSorted((a, b) => a - b))

    const tables = [
      ['member', 'select user_id as id from household_members where household_id = $1 order by updated_at, user_id'],
      ['invitation', 'select id from invitations where household_id = $1 and accepted_at is null order by updated_at, id'],
      ['category', 'select id from categories where household_id = $1 order by updated_at, id'],
      ['contact', 'select id from contacts where household_id = $1 order by updated_at, id'],
    ] as const
    for (const [entity, sql] of tables) {
      const { rows } = await client.query<{ id: string }>(sql, [owner.householdId])
      expect(rows.length, entity).toBeGreaterThan(0)
      expect(
        changes.filter(change => change.entity === entity).map(idOf),
        entity
      ).toEqual(rows.map(row => row.id))
    }
    expect(keys).toContain(`household:${owner.householdId}`)
    expect(keys).toContain(`digest_preferences:${owner.userId}`)
  })

  it('then sends what changed and what was deleted, and not what stayed put', async () => {
    const { owner } = await household()
    const kept = await createContact(owner, db, contact('Kept'))
    const changed = await createContact(owner, db, contact('Changed'))
    const removed = await createContact(owner, db, contact('Removed'))
    await backdateContacts(owner.householdId)
    const full = await walk(owner, undefined, 500)
    expect(full.pages.flatMap(page => page.changes).map(keyOf)).toEqual(expect.arrayContaining([`contact:${kept.id}`, `contact:${removed.id}`]))

    await updateContact(owner, db, changed.id, contact('Changed again'))
    await deleteContact(owner, db, removed.id)
    const { pages } = await walk(owner, full.nextSince, 2)

    const changes = pages.flatMap(page => page.changes)
    const contactsSent = changes.filter(change => change.entity === 'contact')
    expect(contactsSent.map(idOf)).toEqual([changed.id])
    expect(contactsSent[0]?.entity === 'contact' ? contactsSent[0].data.name : null).toBe('Changed again')
    expect(pages.flatMap(page => page.deletes).map(entry => `${entry.entity}:${entry.id}`)).toContain(`contact:${removed.id}`)
    expect(pages.at(-1)?.hasMore).toBe(false)
  })

  it('asks for a resync when the role changed', async () => {
    const { owner, join } = await household()
    const adult = await join('adult')
    const { pages, nextSince } = await walk(adult, undefined, 500)
    expect(pages.flatMap(page => page.changes).some(change => change.entity === 'category')).toBe(true)

    await changeMemberRole(owner, db, { userId: adult.userId, role: 'member' })
    const demoted: RequestContext = { ...adult, role: 'member' }
    const page = syncResponseSchema.parse(await readSyncPage(demoted, db, { since: nextSince, limit: 500 }))
    expect(page).toMatchObject({ changes: [], deletes: [], hasMore: true, resync: true })

    const restart = await walk(demoted, page.nextSince, 500)
    const restarted = restart.pages.flatMap(entry => entry.changes)
    expect(restarted.some(change => change.entity === 'category' || change.entity === 'account')).toBe(false)
    expect(restarted.map(keyOf)).toContain(`household:${owner.householdId}`)
    expect(restart.pages.every(entry => !entry.resync)).toBe(true)
  })

  it("asks for a resync when the cursor is another household's", async () => {
    const first = await household()
    const second = await household()
    const [page] = (await walk(first.owner, undefined, 1)).pages
    if (!page) throw new Error('expected a page')

    const response = syncResponseSchema.parse(await readSyncPage(second.owner, db, { since: page.nextSince, limit: 500 }))

    expect(response).toMatchObject({ changes: [], deletes: [], hasMore: true, resync: true })
    const restart = syncResponseSchema.parse(await readSyncPage(second.owner, db, { since: response.nextSince, limit: 500 }))
    expect(restart.resync).toBe(false)
    expect(restart.changes.map(keyOf)).toContain(`household:${second.owner.householdId}`)
    expect(restart.changes.map(keyOf)).not.toContain(`household:${first.owner.householdId}`)
  })

  it("rejects a since it didn't make", async () => {
    const { owner } = await household()
    const [page] = (await walk(owner, undefined, 1)).pages
    if (!page) throw new Error('expected a page')
    const real: unknown = JSON.parse(Buffer.from(page.nextSince, 'base64url').toString('utf8'))
    const tampered = { ...(real as Record<string, unknown>), last: { at: '2026-09-14T15:00:00.000000Z', id: "1' or '1'='1" } }

    const bad = [
      'not a cursor',
      Buffer.from('not json').toString('base64url'),
      Buffer.from(JSON.stringify({ v: 2 })).toString('base64url'),
      Buffer.from(JSON.stringify(tampered)).toString('base64url'),
    ]
    for (const since of bad) {
      await expect(readSyncPage(owner, db, { since, limit: 10 })).rejects.toBeInstanceOf(ValidationError)
    }
  })
})
