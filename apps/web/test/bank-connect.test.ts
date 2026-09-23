import type { PGlite } from '@electric-sql/pglite'
import type { BankConnection, BankSyncResult, RequestContext } from '@ghar/contracts'
import type { BankTransaction } from '@ghar/core/banking'
import { addCalendarDays } from '@ghar/core/dates'
import { invitationExpiresAt } from '@ghar/core/invitations'
import {
  acceptInvitation,
  createHousehold,
  createInvitation,
  getBankItemCredentials,
  listAccounts,
  listTransactions,
  type Db,
} from '@ghar/db/queries'
import { randomUUID } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { POST as disconnect } from '@/app/api/v1/bank-connections/[itemId]/disconnect/route'
import { DELETE as deleteHistory } from '@/app/api/v1/bank-connections/[itemId]/history/route'
import { POST as reconnect } from '@/app/api/v1/bank-connections/[itemId]/reconnect/route'
import { POST as syncNow } from '@/app/api/v1/bank-connections/[itemId]/sync/route'
import { POST as linkToken } from '@/app/api/v1/bank-connections/link-token/route'
import { POST as connect, GET as listConnections } from '@/app/api/v1/bank-connections/route'
import { POST as plaidWebhook } from '@/app/api/webhooks/plaid/route'
import { openSecret } from '@/lib/crypto'
import { fakePlaidStore, FAKE_LINK_TOKEN, FAKE_PUBLIC_TOKEN } from '@/lib/providers/plaid/fake'

// Connecting a bank end to end: the real routes, real sealing, PGlite, and the in-memory Plaid.
// Without Plaid keys the deployment is on the `fake` environment, which is what a test is.

vi.mock('@/lib/env', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  env: () => ({ ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'), APP_URL: 'https://ghar.test' }),
}))

const test = vi.hoisted(() => ({ db: undefined as unknown, session: null as RequestContext | null }))

vi.mock('@/lib/db', () => ({ getDb: () => test.db }))
vi.mock('@/lib/auth/context', async () => {
  const { UnauthorizedError } = await import('@ghar/core/errors')
  const getRequestContext = () =>
    test.session ? Promise.resolve(test.session) : Promise.reject(new UnauthorizedError('Sign in to continue.'))
  return { getRequestContext, getPageContext: getRequestContext }
})

/** What the fake hands out for the first connection made after the store is cleared. */
const ACCESS_TOKEN = 'access-fake-1'
const PLAID_ITEM_ID = 'item-fake-1'

let client: PGlite
let db: Db

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  test.db = db
}, 60_000)

beforeEach(async () => {
  await client.exec('truncate households, plaid_items cascade')
  test.session = null
  // The fake bank lives on globalThis, so each test starts it over rather than inheriting tokens.
  const store = fakePlaidStore()
  store.items.clear()
  store.changes.clear()
  store.failures.clear()
  store.issued.length = 0
  store.calls.length = 0
})

let households = 0

async function household(): Promise<{ owner: RequestContext; join: (role: 'adult' | 'member') => Promise<RequestContext> }> {
  households += 1
  const n = String(households)
  const email = `bank-owner-${n}@example.com`
  const userId = await createAuthUser(client, email)
  const { household: created } = await createHousehold({ userId, email }, db, {
    name: `Home ${n}`,
    timezone: 'America/New_York',
    currency: 'USD',
  })
  const owner: RequestContext = { userId, householdId: created.id, role: 'owner' }
  return {
    owner,
    join: async role => {
      const joinerEmail = `bank-${role}-${n}@example.com`
      const joinerId = await createAuthUser(client, joinerEmail)
      const now = new Date()
      const tokenHash = `bank-hash-${joinerEmail}`
      await createInvitation(owner, db, { email: joinerEmail, role, tokenHash, expiresAt: invitationExpiresAt(now) })
      await acceptInvitation({ userId: joinerId, email: joinerEmail }, db, { tokenHash, now })
      return { userId: joinerId, householdId: owner.householdId, role }
    },
  }
}

type Handler = typeof syncNow

async function call<T = unknown>(
  handler: Handler | typeof listConnections,
  path: string,
  options: { method?: string; body?: unknown; params?: Record<string, string> } = {}
): Promise<{ status: number; body: T }> {
  const init: RequestInit = { method: options.method ?? 'GET' }
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body)
    init.headers = { 'content-type': 'application/json' }
  }
  const response = await handler(new Request(`http://localhost/api/v1${path}`, init), { params: Promise.resolve(options.params ?? {}) })
  return { status: response.status, body: (await response.json()) as T }
}

type Connected = { connection: BankConnection; sync: BankSyncResult }

const post = <T>(handler: Handler, path: string, body?: unknown, params?: Record<string, string>) =>
  call<T>(handler, path, { method: 'POST', ...(body === undefined ? {} : { body }), ...(params ? { params } : {}) })

const connectBank = () => post<Connected>(connect, '/bank-connections', { publicToken: FAKE_PUBLIC_TOKEN })

type Removed = { connection: BankConnection; removed: { accounts: number; transactions: number } }

const turnOff = (itemId: string) =>
  post<{ connection: BankConnection }>(disconnect, `/bank-connections/${itemId}/disconnect`, undefined, { itemId })

const deleteWhatItBrought = (itemId: string) =>
  call<Removed>(deleteHistory, `/bank-connections/${itemId}/history`, { method: 'DELETE', params: { itemId } })

async function webhook(payload: unknown, options: { signed?: boolean } = {}): Promise<{ status: number; body: { status: string } }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (options.signed !== false) headers['plaid-verification'] = 'fake-jwt'
  const response = await plaidWebhook(
    new Request('http://localhost/api/webhooks/plaid', { method: 'POST', body: JSON.stringify(payload), headers })
  )
  return { status: response.status, body: (await response.json()) as { status: string } }
}

/** One more transaction for the connection, as a later sync would find it. */
function laterTransaction(id: string, amountCents: number): BankTransaction {
  return {
    plaidTransactionId: id,
    plaidAccountId: 'fake-checking',
    pendingTransactionId: null,
    amountCents,
    isoCurrency: 'USD',
    date: addCalendarDays(new Date().toISOString().slice(0, 10), -1),
    authorizedDate: null,
    merchantName: 'Corner Hardware',
    name: 'CORNER HARDWARE',
    paymentChannel: 'in store',
    categoryPrimary: 'HOME_IMPROVEMENT',
    categoryDetailed: 'HOME_IMPROVEMENT_HARDWARE',
    categoryConfidence: 'HIGH',
    isPending: false,
  }
}

describe('connecting a bank', () => {
  it('opens Link, stores the connection sealed, and brings its transactions with it', async () => {
    const { owner } = await household()
    test.session = owner

    const token = await post<{ linkToken: string; provider: string; expiresAt: string }>(linkToken, '/bank-connections/link-token')
    expect(token.status).toBe(200)
    expect(token.body).toMatchObject({ linkToken: FAKE_LINK_TOKEN, provider: 'fake' })

    const created = await connectBank()
    expect(created.status).toBe(201)
    expect(created.body.connection).toMatchObject({
      institutionName: 'Ghar Sample Bank',
      environment: 'fake',
      status: 'good',
      attention: null,
    })

    // Nothing Plaid gave us in confidence comes back out of the API.
    const serialized = JSON.stringify(created.body)
    expect(serialized).not.toContain(ACCESS_TOKEN)
    expect(serialized).not.toContain(PLAID_ITEM_ID)
    expect(serialized).not.toContain('fake-cursor')

    const seeded = fakePlaidStore().items.get(ACCESS_TOKEN)?.transactions ?? []
    expect(seeded.length).toBeGreaterThan(0)
    expect(created.body.sync).toMatchObject({ synced: true, inserted: seeded.length, updated: 0, deleted: 0 })

    // The access token is at rest sealed, and opens to what the fake issued.
    const stored = await getBankItemCredentials(owner, db, { itemId: created.body.connection.id })
    expect(stored.accessTokenEncrypted.startsWith('v1.')).toBe(true)
    expect(stored.accessTokenEncrypted).not.toContain(ACCESS_TOKEN)
    expect(openSecret(stored.accessTokenEncrypted)).toBe(ACCESS_TOKEN)
    expect(stored.cursor).toBe('fake-cursor-1')

    // The accounts arrive with the transactions, so day one isn't empty.
    expect(await listAccounts(owner, db)).toHaveLength(5)
    const landed = await listTransactions(owner, db, {}, { limit: 200 })
    const water = landed.rows.find(row => row.name === 'CITY WATER UTILITY')
    // What the household's rules and Plaid's own category can decide is decided as the money lands,
    // so day one isn't a wall of uncategorized transactions. The model waits for the nightly run.
    expect(water).toMatchObject({ amountCents: -7_412, categoryName: 'Utilities', categorySource: 'pfc', needsReview: false })

    const listed = await call<{ connections: BankConnection[]; provider: string; canConnect: boolean }>(
      listConnections,
      '/bank-connections'
    )
    expect(listed.body).toMatchObject({ provider: 'fake', canConnect: true })
    expect(listed.body.connections).toHaveLength(1)
  })

  it('syncs again on demand without re-reading what it already has', async () => {
    const { owner } = await household()
    test.session = owner
    const connection = (await connectBank()).body.connection

    const store = fakePlaidStore()
    store.push(ACCESS_TOKEN, { added: [laterTransaction('fake-txn-later', -3_150)], modified: [], removed: [] })

    const synced = await post<Connected>(syncNow, `/bank-connections/${connection.id}/sync`, undefined, { itemId: connection.id })
    expect(synced.status).toBe(200)
    expect(synced.body.sync).toMatchObject({ synced: true, inserted: 1, updated: 0, deleted: 0 })
    expect(synced.body.connection.lastSyncedAt).not.toBeNull()

    const found = await listTransactions(owner, db, { q: 'hardware' }, { limit: 5 })
    expect(found.rows).toMatchObject([{ name: 'CORNER HARDWARE', amountCents: -3_150 }])
  })

  it('refuses an update-mode token for a connection that is in good order', async () => {
    const { owner } = await household()
    test.session = owner
    const connection = (await connectBank()).body.connection

    const refused = await post(linkToken, '/bank-connections/link-token', { itemId: connection.id })
    expect(refused.status).toBe(409)
  })
})

describe('what Plaid says afterwards', () => {
  it('records a broken sign-in, and a reconnect puts the connection back to work', async () => {
    const { owner } = await household()
    test.session = owner
    const connection = (await connectBank()).body.connection

    const broke = await webhook({
      webhook_type: 'ITEM',
      webhook_code: 'ERROR',
      item_id: PLAID_ITEM_ID,
      error: { error_code: 'ITEM_LOGIN_REQUIRED' },
    })
    expect(broke).toMatchObject({ status: 200, body: { status: 'state_changed' } })

    const needsAttention = (await call<{ connections: BankConnection[] }>(listConnections, '/bank-connections')).body.connections[0]
    expect(needsAttention).toMatchObject({ status: 'login_required', attention: 'reconnect', canReconnect: true })

    // Update mode is offered now, and finishing it syncs whatever was missed.
    expect((await post(linkToken, '/bank-connections/link-token', { itemId: connection.id })).status).toBe(200)
    fakePlaidStore().push(ACCESS_TOKEN, { added: [laterTransaction('fake-txn-missed', -1_200)], modified: [], removed: [] })

    const repaired = await post<Connected>(reconnect, `/bank-connections/${connection.id}/reconnect`, undefined, { itemId: connection.id })
    expect(repaired.status).toBe(200)
    expect(repaired.body.connection).toMatchObject({ status: 'good', attention: null, canReconnect: false })
    expect(repaired.body.sync).toMatchObject({ synced: true, inserted: 1 })
  })

  it('fetches what a sync webhook announces', async () => {
    const { owner } = await household()
    test.session = owner
    await connectBank()

    fakePlaidStore().push(ACCESS_TOKEN, { added: [laterTransaction('fake-txn-announced', -9_900)], modified: [], removed: [] })
    expect(await webhook({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: PLAID_ITEM_ID })).toMatchObject({
      status: 200,
      body: { status: 'synced' },
    })

    const found = await listTransactions(owner, db, { q: 'hardware' }, { limit: 5 })
    expect(found.rows).toHaveLength(1)
  })

  it('turns away an unsigned webhook, and says nothing about a connection it doesn’t have', async () => {
    const { owner } = await household()
    test.session = owner
    await connectBank()

    const unsigned = await webhook(
      { webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: PLAID_ITEM_ID },
      { signed: false }
    )
    expect(unsigned).toMatchObject({ status: 401, body: { status: 'unverified' } })

    // A 200 either way: Plaid retries anything else, and nothing here reveals which Items exist.
    expect(
      await webhook({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: 'item-somebody-else' })
    ).toMatchObject({
      status: 200,
      body: { status: 'unknown_item' },
    })
    expect(await webhook({ webhook_type: 'ITEM', webhook_code: 'NEW_ACCOUNTS_AVAILABLE', item_id: PLAID_ITEM_ID })).toMatchObject({
      status: 200,
      body: { status: 'ignored' },
    })
  })
})

describe('who may connect a bank', () => {
  it('is owners and adults, in their own household', async () => {
    const home = await household()
    test.session = home.owner
    const connection = (await connectBank()).body.connection

    test.session = await home.join('adult')
    expect((await call(listConnections, '/bank-connections')).status).toBe(200)
    expect((await post(syncNow, `/bank-connections/${connection.id}/sync`, undefined, { itemId: connection.id })).status).toBe(200)

    test.session = await home.join('member')
    expect((await call(listConnections, '/bank-connections')).status).toBe(403)
    expect((await post(linkToken, '/bank-connections/link-token')).status).toBe(403)
    expect((await post(connect, '/bank-connections', { publicToken: FAKE_PUBLIC_TOKEN })).status).toBe(403)
    expect((await post(syncNow, `/bank-connections/${connection.id}/sync`, undefined, { itemId: connection.id })).status).toBe(403)

    // Another household's owner: the connection simply isn't theirs to find.
    const other = await household()
    test.session = other.owner
    expect((await post(syncNow, `/bank-connections/${connection.id}/sync`, undefined, { itemId: connection.id })).status).toBe(404)
    expect((await call(listConnections, '/bank-connections')).body).toMatchObject({ connections: [] })

    test.session = null
    expect((await call(listConnections, '/bank-connections')).status).toBe(401)
    expect((await post(syncNow, `/bank-connections/${randomUUID()}/sync`, undefined, { itemId: randomUUID() })).status).toBe(401)
  })
})

describe('turning a bank off', () => {
  it('revokes the token at Plaid and keeps every account and charge it brought in', async () => {
    const { owner } = await household()
    test.session = owner
    const connected = (await connectBank()).body.connection
    const before = await listTransactions(owner, db, {}, { limit: 200 })

    const off = await turnOff(connected.id)
    expect(off.status).toBe(200)
    expect(off.body.connection).toMatchObject({
      status: 'disconnected',
      attention: null,
      canReconnect: false,
      accountCount: 5,
      transactionCount: before.rows.length,
    })
    expect(off.body.connection.disconnectedAt).not.toBeNull()
    expect(JSON.stringify(off.body)).not.toContain(ACCESS_TOKEN)

    // Plaid was told, and the fake bank no longer answers for that token.
    const store = fakePlaidStore()
    expect(store.calls.filter(entry => entry.method === 'remove')).toEqual([{ method: 'remove', accessToken: ACCESS_TOKEN }])
    expect(store.items.has(ACCESS_TOKEN)).toBe(false)

    // Everything it brought in is still here, filed exactly as it was.
    expect(await listAccounts(owner, db)).toHaveLength(5)
    const after = await listTransactions(owner, db, {}, { limit: 200 })
    expect(after.rows).toHaveLength(before.rows.length)
    expect(after.rows.find(row => row.name === 'CITY WATER UTILITY')).toMatchObject({ categoryName: 'Utilities', categorySource: 'pfc' })

    // And nothing can read the bank with it again: the sealed token is gone.
    await expect(getBankItemCredentials(owner, db, { itemId: connected.id })).rejects.toThrow(/turned off/i)
  })

  it('has nothing more to turn off, sync or reconnect afterwards', async () => {
    const { owner } = await household()
    test.session = owner
    const connection = (await connectBank()).body.connection
    expect((await turnOff(connection.id)).status).toBe(200)

    expect((await turnOff(connection.id)).status).toBe(409)
    expect((await post(syncNow, `/bank-connections/${connection.id}/sync`, undefined, { itemId: connection.id })).status).toBe(409)
    expect((await post(reconnect, `/bank-connections/${connection.id}/reconnect`, undefined, { itemId: connection.id })).status).toBe(409)
    expect((await post(linkToken, '/bank-connections/link-token', { itemId: connection.id })).status).toBe(409)

    // The connection stays on the list: its Plaid Item was spent, and what it brought in is still shown.
    const listed = (await call<{ connections: BankConnection[] }>(listConnections, '/bank-connections')).body.connections
    expect(listed).toMatchObject([{ id: connection.id, status: 'disconnected', accountCount: 5 }])
  })

  it('ignores whatever Plaid says about it afterwards', async () => {
    const { owner } = await household()
    test.session = owner
    const connection = (await connectBank()).body.connection
    const before = await listTransactions(owner, db, {}, { limit: 200 })
    await turnOff(connection.id)

    // The fake would still hand over pages; a connection that is off never asks for them.
    fakePlaidStore().push(ACCESS_TOKEN, { added: [laterTransaction('fake-txn-after-off', -4_400)], modified: [], removed: [] })
    expect(await webhook({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: PLAID_ITEM_ID })).toMatchObject({
      status: 200,
      body: { status: 'ignored' },
    })
    expect(
      await webhook({
        webhook_type: 'ITEM',
        webhook_code: 'ERROR',
        item_id: PLAID_ITEM_ID,
        error: { error_code: 'ITEM_LOGIN_REQUIRED' },
      })
    ).toMatchObject({ status: 200, body: { status: 'ignored' } })

    const listed = (await call<{ connections: BankConnection[] }>(listConnections, '/bank-connections')).body.connections
    expect(listed).toMatchObject([{ status: 'disconnected', attention: null }])
    expect((await listTransactions(owner, db, {}, { limit: 200 })).rows).toHaveLength(before.rows.length)
  })
})

describe('deleting what a connection brought in', () => {
  it('waits until the connection is off, then takes the accounts and their charges with it', async () => {
    const { owner } = await household()
    test.session = owner
    const connection = (await connectBank()).body.connection
    const brought = (await listTransactions(owner, db, {}, { limit: 200 })).rows.length

    // Not while it is still connected: turning it off is the decision, this is the second one.
    expect((await deleteWhatItBrought(connection.id)).status).toBe(409)

    await turnOff(connection.id)
    const deleted = await deleteWhatItBrought(connection.id)
    expect(deleted.status).toBe(200)
    expect(deleted.body.removed).toEqual({ accounts: 5, transactions: brought })
    expect(deleted.body.connection).toMatchObject({ status: 'disconnected', accountCount: 0, transactionCount: 0 })

    expect(await listAccounts(owner, db)).toHaveLength(0)
    expect((await listTransactions(owner, db, {}, { limit: 200 })).rows).toHaveLength(0)

    // The connection itself stays: its Plaid Item is spent whatever happens to the rows.
    expect((await call<{ connections: BankConnection[] }>(listConnections, '/bank-connections')).body.connections).toHaveLength(1)

    // And there is nothing left to delete a second time.
    expect((await deleteWhatItBrought(connection.id)).body.removed).toEqual({ accounts: 0, transactions: 0 })
  })

  it('is for owners and adults, in their own household', async () => {
    const home = await household()
    test.session = home.owner
    const connection = (await connectBank()).body.connection

    test.session = await home.join('member')
    expect((await turnOff(connection.id)).status).toBe(403)
    expect((await deleteWhatItBrought(connection.id)).status).toBe(403)

    const other = await household()
    test.session = other.owner
    expect((await turnOff(connection.id)).status).toBe(404)
    expect((await deleteWhatItBrought(connection.id)).status).toBe(404)

    test.session = null
    expect((await turnOff(connection.id)).status).toBe(401)
    expect((await deleteWhatItBrought(connection.id)).status).toBe(401)

    // An adult may, and everything it brought in survives it.
    test.session = await home.join('adult')
    expect((await turnOff(connection.id)).status).toBe(200)
    expect(await listAccounts(home.owner, db)).toHaveLength(5)
  })
})
