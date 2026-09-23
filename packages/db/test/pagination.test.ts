import type { PGlite } from '@electric-sql/pglite'
import { ValidationError } from '@ghar/core/errors'
import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { transactions } from '../src/schema'
import { createContact, listContactsPage } from '../src/queries/contacts'
import type { Page, PagePosition } from '../src/queries/pagination'
import { createHousehold } from '../src/queries/session'
import { listTripTransactions, listTripTransactionsPage, type TripTransactionRow } from '../src/queries/trip-transactions'
import { createTrip, listTrips, listTripsPage } from '../src/queries/trips'
import type { Db, RequestContext } from '../src/queries/types'
import { createAuthUser, createTestDatabase } from './support/database'

let client: PGlite
let db: Db
let owner: RequestContext
let other: RequestContext

async function household(email: string, name: string): Promise<RequestContext> {
  const userId = await createAuthUser(client, email)
  const joined = await createHousehold({ userId, email }, db, { name, timezone: 'America/Chicago', currency: 'USD' })
  return { userId, householdId: joined.household.id, role: 'owner' }
}

/** Follows `next` from the first page to the last, as a client holding cursors would. */
async function everyPage<Row>(fetch: (after: PagePosition | null) => Promise<Page<Row>>): Promise<{ rows: Row[]; pages: number }> {
  const rows: Row[] = []
  let after: PagePosition | null = null
  let pages = 0
  do {
    const page: Page<Row> = await fetch(after)
    rows.push(...page.rows)
    pages += 1
    after = page.next
    if (pages > 1000) throw new Error('Paging never ended')
  } while (after !== null)
  return { rows, pages }
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  owner = await household('owner@example.com', 'The Rao household')
  other = await household('other@example.com', 'Next door')

  // 250 charges over five dates, so most share a date. Within a date, created times repeat and
  // differ only in the microseconds, which a millisecond cursor would lose.
  const createdAt = ['2026-09-01T10:00:00.123456Z', '2026-09-01T10:00:00.123457Z', '2026-09-01T10:00:00.123457Z']
  await db.insert(transactions).values(
    Array.from({ length: 250 }, (_, index) => ({
      householdId: owner.householdId,
      accountId: null,
      plaidTransactionId: null,
      date: `2026-08-0${(index % 5) + 1}`,
      name: `Charge ${index}`,
      merchantName: null,
      amountCents: -(index + 1) * 100,
      tripId: null,
      createdAt: sql`${createdAt[index % createdAt.length]}::timestamptz`,
    }))
  )
  await db.insert(transactions).values({
    householdId: other.householdId,
    accountId: null,
    plaidTransactionId: null,
    date: '2026-08-03',
    name: 'Not ours',
    merchantName: null,
    amountCents: -500,
    tripId: null,
  })
})

describe('keyset pages', () => {
  it('pages through charges with tied dates: each once, in order, ending with no cursor', async () => {
    const expected = await listTripTransactions(owner, db, { limit: 1000 })
    expect(expected).toHaveLength(250)

    const { rows, pages } = await everyPage(after => listTripTransactionsPage(owner, db, {}, { after, limit: 7 }))
    expect(pages).toBe(Math.ceil(250 / 7))
    expect(rows.map(row => row.id)).toEqual(expected.map(row => row.id))
    expect(new Set(rows.map(row => row.id)).size).toBe(250)
    expect(rows.some(row => row.name === 'Not ours')).toBe(false)

    const rawOrder = await client.query<{ id: string }>(
      `select id from transactions where household_id = $1 order by date desc, created_at desc, id desc`,
      [owner.householdId]
    )
    expect(rows.map(row => row.id)).toEqual(rawOrder.rows.map(row => row.id))
  })

  it('gives no cursor when a page is exactly the rest of the list', async () => {
    const first = await listTripTransactionsPage(owner, db, { from: '2026-08-05', to: '2026-08-05' }, { limit: 50 })
    expect(first.rows).toHaveLength(50)
    expect(first.next).toBeNull()
  })

  it('carries each row’s position, with timestamps to the microsecond', async () => {
    const page: Page<TripTransactionRow> = await listTripTransactionsPage(owner, db, {}, { limit: 3 })
    expect(page.positions).toHaveLength(3)
    expect(page.next).toEqual(page.positions[2])
    const [date, created] = page.positions[0]?.keys ?? []
    expect(date).toBe('2026-08-05')
    expect(created).toMatch(/^2026-09-01T10:00:00\.12345[67]Z$/)
  })

  it('pages trips with undated ones last and tied names broken by id', async () => {
    const base = { destination: null, status: 'planned' as const, coverImageUrl: null, budgetCents: null, notes: null, memberUserIds: [] }
    for (const [index, startsOn] of ['2026-10-01', null, '2026-10-01', null, '2026-11-15', '2026-10-01', null].entries()) {
      await createTrip(owner, db, { ...base, name: index % 2 === 0 ? 'Goa' : 'Pune', startsOn, endsOn: startsOn })
    }
    const today = '2026-09-14'
    const expected = await listTrips(owner, db, { phase: 'all', today })
    const { rows } = await everyPage(after => listTripsPage(owner, db, { phase: 'all', today }, { after, limit: 2 }))

    expect(rows).toHaveLength(7)
    expect(rows.slice(4).every(trip => trip.startsOn === null)).toBe(true)
    // listTrips has no id tiebreak, so compare only what it orders by.
    expect(rows.map(trip => [trip.startsOn, trip.name])).toEqual(expected.map(trip => [trip.startsOn, trip.name]))
    expect(new Set(rows.map(trip => trip.id)).size).toBe(7)
  })

  it('pages contacts by name without regard to case', async () => {
    const blank = { role: null, phone: null, email: null, url: null, notes: null, tags: [] }
    for (const name of ['beta', 'Alpha', 'alpha', 'Gamma', 'ALPHA', 'delta']) {
      await createContact(owner, db, { ...blank, name })
    }
    const { rows } = await everyPage(after => listContactsPage(owner, db, { after, limit: 2 }))
    expect(rows.map(contact => contact.name.toLowerCase())).toEqual(['alpha', 'alpha', 'alpha', 'beta', 'delta', 'gamma'])
    expect(new Set(rows.map(contact => contact.id)).size).toBe(6)
  })

  it('refuses a position that does not fit the list', async () => {
    const [valid] = (await listTripTransactionsPage(owner, db, {}, { limit: 1 })).positions
    if (!valid) throw new Error('Expected a position')

    const broken: PagePosition[] = [
      { ...valid, id: 'not-a-uuid' },
      { ...valid, keys: valid.keys.slice(0, 1) },
      { ...valid, keys: ['2026-02-30', valid.keys[1] ?? null] },
      { ...valid, keys: [valid.keys[0] ?? null, '2026-09-01T10:00:00.123Z'] },
      { ...valid, keys: [null, valid.keys[1] ?? null] },
      { ...valid, keys: ["2026-08-05'); drop table transactions; --", valid.keys[1] ?? null] },
    ]
    for (const after of broken) {
      await expect(listTripTransactionsPage(owner, db, {}, { after, limit: 5 })).rejects.toBeInstanceOf(ValidationError)
    }
    await expect(listTripTransactionsPage(owner, db, {}, { after: valid, limit: 5 })).resolves.toMatchObject({ rows: expect.any(Array) })
  })
})
