import type { PGlite } from '@electric-sql/pglite'
import type { MonthPaceValue, NetWorthGlanceValue, RequestContext, Transaction } from '@ghar/contracts'
import { invitationExpiresAt } from '@ghar/core/invitations'
import {
  acceptInvitation,
  applyTransactionSync,
  createBankItem,
  createHousehold,
  createInvitation,
  createTrip,
  ensureDefaultCategories,
  listAccounts,
  listCategories,
  setAccountHidden,
  setBudgetLine,
  type Db,
} from '@ghar/db/queries'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { GET as overview } from '@/app/api/v1/finances/overview/route'
import { PATCH as tag } from '@/app/api/v1/transactions/[transactionId]/route'
import { GET as list, POST as create } from '@/app/api/v1/transactions/route'

// /api/v1/transactions against PGlite: what the money screen reads and what the sheet writes. The
// household is whoever the test says is signed in, and nothing here trusts a household id from a
// request.

const test = vi.hoisted(() => ({ db: undefined as unknown, session: null as RequestContext | null }))

vi.mock('@/lib/db', () => ({ getDb: () => test.db }))
vi.mock('@/lib/auth/context', async () => {
  const { UnauthorizedError } = await import('@ghar/core/errors')
  const getRequestContext = () =>
    test.session ? Promise.resolve(test.session) : Promise.reject(new UnauthorizedError('Sign in to continue.'))
  return { getRequestContext, getPageContext: getRequestContext }
})

const TIME_ZONE = 'America/Chicago'

let client: PGlite
let db: Db
let owner: RequestContext
let adult: RequestContext
let member: RequestContext
/** The accounts the sync created, by name. */
let accounts: Record<string, string>
/** Every charge the sync brought in, by the name on it. */
let ids: Record<string, string>

interface OverviewBody {
  today: string
  monthStart: string
  spentCents: number
  incomeCents: number
  previousSpentCents: number
  changeCents: number
  changeShare: number | null
  categories: { categoryId: string | null; name: string; spentCents: number; share: number }[]
  budget: { periodStart: string; availableCents: number; spentCents: number; pace: string; elapsedShare: number } | null
  cashCents: number
  cardsCents: number
  pace: MonthPaceValue
  netWorth: NetWorthGlanceValue | null
  reviewCount: number
  recent: Transaction[]
}

async function getOverview(): Promise<{ status: number; body: OverviewBody }> {
  const response = await overview(new Request('http://localhost/api/v1/finances/overview'), { params: Promise.resolve({}) })
  return { status: response.status, body: (await response.json()) as OverviewBody }
}

interface ListBody {
  items: Transaction[]
  nextCursor: string | null
  reviewCount: number
}

async function listCharges(query: Record<string, string> = {}): Promise<{ status: number; body: ListBody }> {
  const url = new URL('http://localhost/api/v1/transactions')
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
  const response = await list(new Request(url), { params: Promise.resolve({}) })
  return { status: response.status, body: (await response.json()) as ListBody }
}

async function post(body: unknown): Promise<{ status: number; body: { transaction: Transaction; error?: string } }> {
  const response = await create(
    new Request('http://localhost/api/v1/transactions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) }
  )
  return { status: response.status, body: (await response.json()) as { transaction: Transaction } }
}

async function patch(transactionId: string, body: unknown): Promise<{ status: number; body: { transaction: Transaction } }> {
  const response = await tag(
    new Request(`http://localhost/api/v1/transactions/${transactionId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ transactionId }) }
  )
  return { status: response.status, body: (await response.json()) as { transaction: Transaction } }
}

async function categoryKeyed(systemKey: string, ctx: RequestContext = owner): Promise<string> {
  const category = (await listCategories(ctx, db)).find(row => row.systemKey === systemKey)
  if (!category) throw new Error(`No ${systemKey} category`)
  return category.id
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  test.db = db

  const ownerId = await createAuthUser(client, 'txn-owner@example.com')
  const { household } = await createHousehold({ userId: ownerId, email: 'txn-owner@example.com' }, db, {
    name: 'The Rao household',
    timezone: TIME_ZONE,
    currency: 'USD',
  })
  owner = { userId: ownerId, householdId: household.id, role: 'owner' }
  await ensureDefaultCategories(owner, db)

  for (const role of ['adult', 'member'] as const) {
    const email = `txn-${role}@example.com`
    const userId = await createAuthUser(client, email)
    const tokenHash = `txn-hash-${role}`
    await createInvitation(owner, db, { email, role, tokenHash, expiresAt: invitationExpiresAt(new Date()) })
    await acceptInvitation({ userId, email }, db, { tokenHash, now: new Date() })
    const joined: RequestContext = { userId, householdId: household.id, role }
    if (role === 'adult') adult = joined
    else member = joined
  }

  const item = await createBankItem(owner, db, {
    environment: 'fake',
    plaidItemId: 'item-txn',
    institutionId: null,
    institutionName: 'Test Bank',
    accessTokenEncrypted: 'v1:test:test:test',
  })
  const bankAccount = (plaidAccountId: string, name: string, mask: string) => ({
    plaidAccountId,
    name,
    officialName: null,
    mask,
    type: 'depository' as const,
    subtype: 'checking',
    currentBalanceCents: 100_000,
    availableBalanceCents: 100_000,
    isoCurrency: 'USD',
  })
  const charge = (plaidTransactionId: string, plaidAccountId: string, date: string, name: string, amountCents: number) => ({
    plaidTransactionId,
    plaidAccountId,
    pendingTransactionId: null,
    isoCurrency: 'USD',
    date,
    authorizedDate: null,
    merchantName: null,
    name,
    paymentChannel: 'in store',
    categoryPrimary: null,
    categoryDetailed: null,
    categoryConfidence: null,
    isPending: false,
    amountCents,
  })

  await applyTransactionSync({ householdId: household.id, userId: null }, db, {
    itemId: item.id,
    expectedCursor: null,
    nextCursor: 'cursor-1',
    now: new Date(),
    accounts: [bankAccount('acct-checking', 'Checking', '0001'), bankAccount('acct-savings', 'Savings', '0002')],
    pages: [
      {
        added: [
          charge('c-1', 'acct-checking', '2026-08-03', 'TRADER JOES 552', -4520),
          charge('c-2', 'acct-checking', '2026-08-10', 'POS 88213', -12_000),
          charge('c-3', 'acct-checking', '2026-08-18', 'ACE HARDWARE', -3000),
          charge('s-1', 'acct-savings', '2026-08-20', 'INTEREST PAID', 412),
        ],
        modified: [],
        removed: [],
      },
    ],
  })

  accounts = Object.fromEntries((await listAccounts(owner, db)).map(row => [row.name, row.id]))
  const { rows } = await client.query<{ id: string; plaid_transaction_id: string }>(
    'select id, plaid_transaction_id from transactions where plaid_transaction_id is not null'
  )
  ids = Object.fromEntries(rows.map(row => [row.plaid_transaction_id, row.id]))
  test.session = owner
}, 60_000)

describe('listing charges', () => {
  it('returns the household’s charges newest first, with the account each one is on', async () => {
    test.session = owner
    const { status, body } = await listCharges()

    expect(status).toBe(200)
    expect(body.items.map(item => item.description)).toEqual(['INTEREST PAID', 'ACE HARDWARE', 'POS 88213', 'TRADER JOES 552'])
    expect(body.items[0]).toMatchObject({
      accountId: accounts.Savings,
      accountLabel: expect.stringContaining('Savings'),
      amountCents: 412,
      tripId: null,
      categoryId: null,
    })
    expect(body.nextCursor).toBeNull()
    // Nothing has filed any of them yet, so all four are waiting.
    expect(body.reviewCount).toBe(4)
  })

  it('narrows by account, by search and to the review queue', async () => {
    test.session = owner

    const checking = await listCharges({ accountId: accounts.Checking ?? '' })
    expect(checking.body.items).toHaveLength(3)

    const searched = await listCharges({ q: 'hardware' })
    expect(searched.body.items.map(item => item.description)).toEqual(['ACE HARDWARE'])

    const filed = await patch(ids['c-3'] ?? '', { categoryId: await categoryKeyed('home_maintenance') })
    expect(filed.body.transaction).toMatchObject({ categoryName: 'Repairs and improvements', categorySource: 'user', needsReview: false })

    const queue = await listCharges({ review: '1' })
    expect(queue.body.items.map(item => item.description)).not.toContain('ACE HARDWARE')
    expect(queue.body.reviewCount).toBe(3)

    const unfiled = await listCharges({ categoryId: 'none' })
    expect(unfiled.body.items).toHaveLength(3)
    const home = await listCharges({ categoryId: await categoryKeyed('home_maintenance') })
    expect(home.body.items.map(item => item.id)).toEqual([ids['c-3']])
  })

  it('leaves a hidden account’s charges out until the list asks for that account by name', async () => {
    test.session = owner
    const before = await listCharges()

    await setAccountHidden(owner, db, { accountId: accounts.Savings ?? '', isHidden: true })
    const visible = await listCharges()
    const asked = await listCharges({ accountId: accounts.Savings ?? '' })
    await setAccountHidden(owner, db, { accountId: accounts.Savings ?? '', isHidden: false })

    expect(visible.body.items.map(item => item.description)).not.toContain('INTEREST PAID')
    expect(asked.body.items.map(item => item.description)).toEqual(['INTEREST PAID'])
    // The queue shrinks with it: a hidden account isn't asking to be filed.
    expect(visible.body.reviewCount).toBe(before.body.reviewCount - 1)
  })

  it('pages with a cursor, and refuses one from a different question', async () => {
    test.session = owner
    const first = await listCharges({ limit: '2' })
    expect(first.body.items).toHaveLength(2)
    expect(first.body.nextCursor).not.toBeNull()

    const second = await listCharges({ limit: '2', cursor: first.body.nextCursor ?? '' })
    expect(second.body.items).toHaveLength(2)
    expect(second.body.nextCursor).toBeNull()
    const seen = [...first.body.items, ...second.body.items].map(item => item.id)
    expect(new Set(seen).size).toBe(4)

    // The same cursor against a narrower list would skip rows, so it is refused instead.
    const changed = await listCharges({ limit: '2', cursor: first.body.nextCursor ?? '', q: 'hardware' })
    expect(changed.status).toBe(400)
  })
})

describe('changing a charge', () => {
  it('records a charge typed in by hand, which belongs to no account', async () => {
    test.session = adult
    const created = await post({ postedOn: '2026-09-01', description: 'Dinner, cash', merchant: 'Casa Maria', amountCents: -3600 })

    expect(created.status).toBe(201)
    expect(created.body.transaction).toMatchObject({
      description: 'Dinner, cash',
      merchant: 'Casa Maria',
      amountCents: -3600,
      accountId: null,
      accountLabel: null,
      categoryId: null,
    })

    // It sits at the top of the list with everything else, and waits to be filed like everything else.
    const { body } = await listCharges()
    expect(body.items[0]?.id).toBe(created.body.transaction.id)
    const queue = await listCharges({ review: '1' })
    expect(queue.body.items.map(item => item.id)).toContain(created.body.transaction.id)
  })

  it('files a charge, takes it out of spending, keeps a note, and can unfile it again', async () => {
    test.session = adult
    const groceries = await categoryKeyed('groceries')

    const filed = await patch(ids['c-1'] ?? '', { categoryId: groceries, notes: 'Split with the Patels' })
    expect(filed.status).toBe(200)
    expect(filed.body.transaction).toMatchObject({
      categoryId: groceries,
      categoryName: 'Groceries',
      categorySource: 'user',
      needsReview: false,
      notes: 'Split with the Patels',
    })

    const excluded = await patch(ids['c-2'] ?? '', { isExcluded: true })
    expect(excluded.body.transaction.isExcluded).toBe(true)
    // Excluding it answers the question too, so it leaves the queue.
    const queue = await listCharges({ review: '1' })
    expect(queue.body.items.map(item => item.id)).not.toContain(ids['c-2'])

    const unfiled = await patch(ids['c-1'] ?? '', { categoryId: null })
    expect(unfiled.body.transaction).toMatchObject({ categoryId: null, categoryName: null, categorySource: 'user', needsReview: false })
    // Unfiled on purpose is not the same as never filed: it stays out of the queue.
    const after = await listCharges({ review: '1' })
    expect(after.body.items.map(item => item.id)).not.toContain(ids['c-1'])
  })

  it('tags a charge to a trip and takes it off again, which is what a trip’s spend adds up', async () => {
    test.session = owner
    const trip = await createTrip(owner, db, {
      name: 'Lisbon',
      destination: 'Lisbon, Portugal',
      startsOn: '2026-08-01',
      endsOn: '2026-08-21',
      status: 'planned',
      coverImageUrl: null,
      budgetCents: 400_000,
      notes: null,
      travellerIds: [],
    })

    const tagged = await patch(ids['c-2'] ?? '', { tripId: trip.id })
    expect(tagged.body.transaction.tripId).toBe(trip.id)
    expect((await listCharges({ tripId: trip.id })).body.items.map(item => item.id)).toEqual([ids['c-2']])
    expect((await listCharges({ untagged: '1' })).body.items.map(item => item.id)).not.toContain(ids['c-2'])

    const untagged = await patch(ids['c-2'] ?? '', { tripId: null })
    expect(untagged.body.transaction.tripId).toBeNull()
    expect((await listCharges({ untagged: '1' })).body.items.map(item => item.id)).toContain(ids['c-2'])
  })

  it('refuses a category from another household, and an edit that changes nothing', async () => {
    test.session = owner
    const otherId = await createAuthUser(client, 'other-owner@example.com')
    const { household: other } = await createHousehold({ userId: otherId, email: 'other-owner@example.com' }, db, {
      name: 'Somebody else',
      timezone: 'UTC',
      currency: 'USD',
    })
    const theirs: RequestContext = { userId: otherId, householdId: other.id, role: 'owner' }
    await ensureDefaultCategories(theirs, db)

    expect((await patch(ids['c-3'] ?? '', { categoryId: await categoryKeyed('groceries', theirs) })).status).toBe(400)
    expect((await patch(ids['c-3'] ?? '', {})).status).toBe(400)
  })

  it('keeps members out of the household’s money altogether', async () => {
    test.session = member
    expect((await listCharges()).status).toBe(403)
    expect((await patch(ids['c-3'] ?? '', { isExcluded: true })).status).toBe(403)
    expect((await post({ postedOn: '2026-09-02', description: 'Coffee', amountCents: -500 })).status).toBe(403)

    test.session = null
    expect((await listCharges()).status).toBe(401)
  })
})

describe('the month so far', () => {
  // The household's today, so the windows the overview compares are the same every run.
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-22T15:00:00Z'))
  })
  afterAll(() => {
    vi.useRealTimers()
  })

  it('answers the month against the same days of the month before', async () => {
    test.session = owner
    const { status, body } = await getOverview()

    expect(status).toBe(200)
    expect(body).toMatchObject({ today: '2026-09-22', monthStart: '2026-09-01' })
    // September so far is the one charge typed in by hand; August to the 22nd is what it is measured against.
    expect(body.spentCents).toBe(3600)
    expect(body.previousSpentCents).toBe(7520)
    expect(body.changeCents).toBe(-3920)
    expect(body.changeShare).toBeCloseTo(-3920 / 7520)
    expect(body.incomeCents).toBe(0)
    expect(body.categories).toEqual([{ categoryId: null, name: 'Not filed yet', spentCents: 3600, share: 1 }])
    expect(body.budget).toBeNull()
    // Day by day: September runs to today, August is there whole to set it against.
    expect(body.pace).toMatchObject({ monthStart: '2026-09-01', daysInMonth: 30, day: 22, budgetCents: null, empty: false })
    expect(body.pace.current).toHaveLength(23)
    expect(body.pace.current.at(-1)).toBe(3600)
    expect(body.pace.previousByNowCents).toBe(7520)
    expect(body.netWorth).toBeNull()

    // Both bank accounts are everyday accounts, and there are no cards.
    expect(body).toMatchObject({ cashCents: 200_000, cardsCents: 0 })
    // The savings interest and the cash dinner are the two nobody has answered for.
    expect(body.reviewCount).toBe(2)
    expect(body.recent.map(charge => charge.description)).toEqual([
      'Dinner, cash',
      'INTEREST PAID',
      'ACE HARDWARE',
      'POS 88213',
      'TRADER JOES 552',
    ])
  })

  it('names the category once a charge is filed, and the plan once the month has one', async () => {
    test.session = owner
    const groceries = await categoryKeyed('groceries')
    const dinner = (await listCharges()).body.items[0]
    await patch(dinner?.id ?? '', { categoryId: groceries })
    await setBudgetLine(owner, db, { periodStart: '2026-09-01', categoryId: groceries, plannedCents: 50_000, rolloverEnabled: false })

    const { body } = await getOverview()
    // Groceries sits under Food and drink, and the overview names the heading, not the leaf.
    const food = await categoryKeyed('food')
    expect(body.categories).toEqual([{ categoryId: food, name: 'Food and drink', spentCents: 3600, share: 1 }])
    expect(body.budget).toMatchObject({ periodStart: '2026-09-01', availableCents: 50_000, spentCents: 3600, pace: 'under_pace' })
    expect(body.budget?.elapsedShare).toBeCloseTo(22 / 30)
    expect(body.pace).toMatchObject({ budgetCents: 50_000, budgetByNowCents: Math.round((50_000 * 22) / 30) })
    // Filing it answers for it, so only the savings interest is still waiting.
    expect(body.reviewCount).toBe(1)
  })

  it('keeps members out, and answers nothing at all when signed out', async () => {
    test.session = member
    expect((await getOverview()).status).toBe(403)
    test.session = null
    expect((await getOverview()).status).toBe(401)
  })
})
