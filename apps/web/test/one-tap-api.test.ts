import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { todayInTimeZone } from '@ghar/core/dates'
import {
  createActionToken,
  createBill,
  createHousehold,
  ensureDefaultCategories,
  getTransaction,
  listBillPayments,
  listCategories,
  type Db,
  type RequestContext,
} from '@ghar/db/queries'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { GET, POST } from '@/app/api/v1/one-tap/[token]/route'
import { deriveOneTapKey, oneTapPath, type OneTapGrant } from '@/lib/one-tap'
import { syncedTransaction } from './support/bank'

// GET and POST /api/v1/one-tap/:token: the digest's one-tap links, for the phone. The link rules
// themselves are in one-tap.test.ts; this checks what the API says and that the token is enough.

const KEY = deriveOneTapKey(Buffer.alloc(32, 7))
const TZ = 'America/Chicago'
const NOW = new Date()
const TODAY = todayInTimeZone(TZ, NOW)

const test = vi.hoisted(() => ({ db: undefined as unknown }))
vi.mock('@/lib/db', () => ({ getDb: () => test.db }))
vi.mock('@/lib/one-tap', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/one-tap')>()),
  getOneTapKey: () => KEY,
}))

let client: PGlite
let db: Db
let owner: RequestContext

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  test.db = db
  const ownerId = await createAuthUser(client, 'owner@example.com')
  const { household } = await createHousehold({ userId: ownerId, email: 'owner@example.com' }, db, {
    name: 'The Rao household',
    timezone: TZ,
    currency: 'USD',
  })
  owner = { userId: ownerId, householdId: household.id, role: 'owner' }
  await ensureDefaultCategories(owner, db)
}, 60_000)

async function link(grant: Omit<OneTapGrant, 'tokenId'>, { expired = false } = {}): Promise<string> {
  const { id } = await createActionToken(owner, db, { userId: owner.userId, ...grant, expiresAt: new Date(NOW.getTime() + 3_600_000) })
  if (expired) {
    // A row can't be made already expired (expires_at > created_at), so age it instead.
    await client.query(`update action_tokens set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' where id = $1`, [id])
  }
  return oneTapPath(KEY, { tokenId: id, ...grant }).slice('/a/'.length)
}

async function call(method: 'GET' | 'POST', token: string, init: { body?: unknown; headers?: Record<string, string> } = {}) {
  const url = `http://localhost/api/v1/one-tap/${encodeURIComponent(token)}`
  const request =
    init.body === undefined
      ? new Request(url, { method, headers: { ...init.headers } })
      : new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...init.headers }, body: JSON.stringify(init.body) })
  const handler = method === 'GET' ? GET : POST
  const response = await handler(request, { params: Promise.resolve({ token }) })
  const text = await response.text()
  // Nothing the API says, success or failure, repeats the credential.
  expect(text).not.toContain(token)
  expect(text).not.toContain(token.split('.')[1] ?? token)
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown> }
}

function purchase(): Promise<string> {
  return syncedTransaction(client, db, owner, { date: TODAY, name: 'SQ *BLUE BOTTLE 0421', merchantName: 'Blue Bottle', amountCents: -650 })
}

async function childCategory(): Promise<{ id: string; name: string }> {
  const child = (await listCategories(owner, db)).find(row => row.parentId !== null && !row.isArchived)
  if (!child) throw new Error('expected default categories')
  return child
}

describe('categorize links', () => {
  it('describes the link without a session and without using it up', async () => {
    const transactionId = await purchase()
    const category = await childCategory()
    const token = await link({ action: 'categorize_transaction', entityId: transactionId, dueOn: null })

    const first = await call('GET', token)
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({
      state: 'categorize',
      usable: true,
      currency: 'USD',
      transaction: { description: 'Blue Bottle', date: TODAY, amountCents: -650, categoryId: null },
    })
    expect(first.body.categories).toContainEqual(expect.objectContaining({ id: category.id }))
    expect((await call('GET', token)).body.state).toBe('categorize')
  })

  it('files the transaction once', async () => {
    const transactionId = await purchase()
    const category = await childCategory()
    const token = await link({ action: 'categorize_transaction', entityId: transactionId, dueOn: null })

    expect(await call('POST', token, { body: { categoryId: category.id } })).toEqual({ status: 200, body: { message: `Filed under ${category.name}.` } })
    expect((await getTransaction(owner, db, { transactionId })).categoryId).toBe(category.id)

    const again = await call('POST', token, { body: { categoryId: category.id } })
    expect(again.status).toBe(409)
    expect(again.body).toMatchObject({ error: { code: 'conflict' } })
    expect((await call('GET', token)).body).toEqual({ state: 'used', usable: false })
  })

  it('refuses a missing or foreign category and keeps the link working', async () => {
    const transactionId = await purchase()
    const token = await link({ action: 'categorize_transaction', entityId: transactionId, dueOn: null })

    expect((await call('POST', token)).status).toBe(400)
    expect((await call('POST', token, { body: { categoryId: randomUUID() } })).body).toMatchObject({ error: { code: 'validation_error' } })
    expect((await call('POST', token, { body: { categoryId: 'not-a-uuid' } })).status).toBe(400)
    expect((await call('GET', token)).body.state).toBe('categorize')
  })
})

describe('mark paid links', () => {
  it('marks the bill paid with no body, once', async () => {
    const bill = await createBill(owner, db, {
      name: 'Rent',
      payee: 'Maple Court Apartments',
      amountCents: 245_000,
      isVariable: false,
      cadence: 'monthly',
      dueDay: 1,
      dueMonth: null,
      autopay: false,
      accountId: null,
      categoryId: null,
      url: null,
      notes: null,
    })
    const dueOn = `${TODAY.slice(0, 7)}-01`
    const token = await link({ action: 'mark_bill_paid', entityId: bill.id, dueOn })

    expect((await call('GET', token)).body).toEqual({ state: 'mark_paid', usable: true, currency: 'USD', bill: { name: 'Rent', dueOn, amountCents: 245_000 } })
    expect(await call('POST', token)).toEqual({ status: 200, body: { message: 'Marked paid.' } })
    expect(await listBillPayments(owner, db)).toContainEqual({ billId: bill.id, dueOn, paidOn: TODAY })
    expect((await call('POST', token)).status).toBe(409)
  })
})

describe('links that don’t work', () => {
  it('describes an unknown or altered link as invalid and refuses to use it', async () => {
    const transactionId = await purchase()
    const token = await link({ action: 'categorize_transaction', entityId: transactionId, dueOn: null })
    // The first signature character: the last one carries two padding bits that decode away.
    const [tokenId = '', signature = ''] = token.split('.')
    const altered = `${tokenId}.${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`

    expect(await call('GET', 'garbage')).toEqual({ status: 200, body: { state: 'invalid', usable: false } })
    expect((await call('GET', altered)).body).toEqual({ state: 'invalid', usable: false })
    const refused = await call('POST', altered)
    expect(refused.status).toBe(400)
    expect(refused.body).toMatchObject({ error: { code: 'validation_error' } })
  })

  it('says an expired link has expired', async () => {
    const transactionId = await purchase()
    const category = await childCategory()
    const token = await link({ action: 'categorize_transaction', entityId: transactionId, dueOn: null }, { expired: true })

    expect((await call('GET', token)).body).toEqual({ state: 'expired', usable: false })
    expect((await call('POST', token, { body: { categoryId: category.id } })).status).toBe(400)
    expect((await getTransaction(owner, db, { transactionId })).categoryId).toBeNull()
  })

  it('refuses a cross-site form post that carries cookies', async () => {
    const transactionId = await purchase()
    const category = await childCategory()
    const token = await link({ action: 'categorize_transaction', entityId: transactionId, dueOn: null })

    const response = await call('POST', token, { body: { categoryId: category.id }, headers: { cookie: 'a=b', origin: 'https://evil.example' } })
    expect(response.status).toBe(403)
    expect((await getTransaction(owner, db, { transactionId })).categoryId).toBeNull()
  })
})
