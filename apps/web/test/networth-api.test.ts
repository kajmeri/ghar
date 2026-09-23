import type { PGlite } from '@electric-sql/pglite'
import type {
  Debt,
  ManualAccount,
  ManualValue,
  NetWorthComposition,
  NetWorthHistoryEntry,
  NetWorthResponse,
  RequestContext,
} from '@ghar/contracts'
import { addCalendarDays, todayInTimeZone } from '@ghar/core/dates'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { acceptInvitation, createBankItem, createHousehold, createInvitation, type Db } from '@ghar/db/queries'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { DELETE as deleteAccount, GET as getAccount, PUT as updateAccount } from '@/app/api/v1/manual-accounts/[manualAccountId]/route'
import { DELETE as deleteValue } from '@/app/api/v1/manual-accounts/[manualAccountId]/values/[valueId]/route'
import { POST as addValue, GET as listValues } from '@/app/api/v1/manual-accounts/[manualAccountId]/values/route'
import { POST as createAccount, GET as listAccounts } from '@/app/api/v1/manual-accounts/route'
import { GET as getComposition } from '@/app/api/v1/net-worth/composition/route'
import { GET as listDebts } from '@/app/api/v1/net-worth/debts/route'
import { DELETE as deleteHistory } from '@/app/api/v1/net-worth/history/[entryId]/route'
import { GET as listHistory, POST as saveHistory } from '@/app/api/v1/net-worth/history/route'
import { GET as getNetWorth } from '@/app/api/v1/net-worth/route'
import { runBalanceSync, runInvestmentsSync, runLiabilitiesSync, type BankRefreshDeps } from '@/lib/banking/refresh'
import { runNetWorthSnapshots } from '@/lib/networth/snapshots'
import { createFakePlaidClient, FakePlaidStore, sampleFakePlaidItem } from '@/lib/providers/plaid/fake'

// /api/v1/net-worth and /api/v1/manual-accounts run for real against PGlite and the in-memory Plaid;
// the session is whoever the test says is signed in. Changing a manual account takes today's snapshot
// again, so these read the real clock in the household's time zone.

const test = vi.hoisted(() => ({ db: undefined as unknown, session: null as RequestContext | null }))

vi.mock('@/lib/db', () => ({ getDb: () => test.db }))
vi.mock('@/lib/auth/context', async () => {
  const { UnauthorizedError } = await import('@ghar/core/errors')
  const getRequestContext = () =>
    test.session ? Promise.resolve(test.session) : Promise.reject(new UnauthorizedError('Sign in to continue.'))
  return { getRequestContext, getPageContext: getRequestContext }
})

const TIME_ZONE = 'America/New_York'
const today = () => todayInTimeZone(TIME_ZONE)

let client: PGlite
let db: Db

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  test.db = db
}, 60_000)

beforeEach(async () => {
  // The bank jobs read every connection in the database.
  await client.exec('truncate households, plaid_items cascade')
  test.session = null
})

let households = 0

async function household(): Promise<{ owner: RequestContext; join: (role: 'adult' | 'member') => Promise<RequestContext> }> {
  households += 1
  const n = String(households)
  const email = `networth-owner-${n}@example.com`
  const userId = await createAuthUser(client, email)
  const { household: created } = await createHousehold({ userId, email }, db, { name: `Home ${n}`, timezone: TIME_ZONE, currency: 'USD' })
  const owner: RequestContext = { userId, householdId: created.id, role: 'owner' }
  return {
    owner,
    join: async role => {
      const joinerEmail = `networth-${role}-${n}@example.com`
      const joinerId = await createAuthUser(client, joinerEmail)
      const now = new Date()
      const tokenHash = `networth-hash-${joinerEmail}`
      await createInvitation(owner, db, { email: joinerEmail, role, tokenHash, expiresAt: invitationExpiresAt(now) })
      await acceptInvitation({ userId: joinerId, email: joinerEmail }, db, { tokenHash, now })
      return { userId: joinerId, householdId: owner.householdId, role }
    },
  }
}

type Handler = typeof getNetWorth
type Page<Item> = { items: Item[]; nextCursor: string | null }

async function call<T = unknown>(
  handler: Handler,
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

const post = <T>(handler: Handler, path: string, body: unknown, params?: Record<string, string>) =>
  call<T>(handler, path, { method: 'POST', body, ...(params ? { params } : {}) })

describe('manual accounts', () => {
  it('keeps every value, and net worth follows the newest one', async () => {
    const { owner } = await household()
    test.session = owner

    const created = await post<{ account: ManualAccount }>(createAccount, '/manual-accounts', {
      name: 'House',
      kind: 'property',
      reminderCadenceMonths: 6,
      value: { asOf: addCalendarDays(today(), -30), valueCents: 50_000_000, source: 'estimate' },
    })
    expect(created.status).toBe(201)
    const house = created.body.account
    expect(house).toMatchObject({ name: 'House', isLiability: false, latestValue: { valueCents: 50_000_000, source: 'estimate' } })

    const loan = (
      await post<{ account: ManualAccount }>(createAccount, '/manual-accounts', {
        name: 'Car loan',
        kind: 'loan',
        value: { asOf: today(), valueCents: 1_500_000 },
      })
    ).body.account
    expect(loan.isLiability).toBe(true)

    const houseParams = { manualAccountId: house.id }
    const added = await post<{ value: ManualValue; account: ManualAccount }>(
      addValue,
      `/manual-accounts/${house.id}/values`,
      { asOf: today(), valueCents: 52_000_000 },
      houseParams
    )
    expect(added.status).toBe(201)
    expect(added.body.account.latestValue?.valueCents).toBe(52_000_000)

    const values = await call<Page<ManualValue>>(listValues, `/manual-accounts/${house.id}/values`, { params: houseParams })
    expect(values.body.items.map(value => value.valueCents)).toEqual([52_000_000, 50_000_000])

    const worth = await call<NetWorthResponse>(getNetWorth, '/net-worth')
    expect(worth.status).toBe(200)
    expect(worth.body.latest).toMatchObject({
      asOf: today(),
      assetsCents: 52_000_000,
      liabilitiesCents: -1_500_000,
      netCents: 50_500_000,
      staleAccountCount: 0,
    })
    expect(worth.body.assets.accounts).toMatchObject([
      { name: 'House', source: 'manual', typeLabel: 'Property', balanceCents: 52_000_000, updatedOn: today() },
    ])
    expect(worth.body.liabilities.accounts).toMatchObject([
      { name: 'Car loan', source: 'manual', typeLabel: 'Loan', balanceCents: -1_500_000 },
    ])

    const debts = await call<{ debts: Debt[] }>(listDebts, '/net-worth/debts')
    expect(debts.body.debts).toMatchObject([{ id: loan.id, source: 'manual', kind: 'other', balanceCents: -1_500_000, aprPercent: null }])

    const removed = await call<{ valueId: string; account: ManualAccount }>(
      deleteValue,
      `/manual-accounts/${house.id}/values/${added.body.value.id}`,
      {
        method: 'DELETE',
        params: { ...houseParams, valueId: added.body.value.id },
      }
    )
    expect(removed.status).toBe(200)
    expect(removed.body.account.latestValue?.valueCents).toBe(50_000_000)
    expect((await call<NetWorthResponse>(getNetWorth, '/net-worth')).body.latest?.netCents).toBe(48_500_000)

    const archived = await call<{ account: ManualAccount }>(updateAccount, `/manual-accounts/${house.id}`, {
      method: 'PUT',
      params: houseParams,
      body: { name: 'House', kind: 'property', archived: true },
    })
    expect(archived.status).toBe(200)
    expect(archived.body.account.archivedAt).not.toBeNull()
    expect((await call<Page<ManualAccount>>(listAccounts, '/manual-accounts')).body.items.map(account => account.name)).toEqual([
      'Car loan',
    ])
    expect(
      (await call<Page<ManualAccount>>(listAccounts, '/manual-accounts?includeArchived=true')).body.items.map(account => account.name)
    ).toEqual(['Car loan', 'House'])
    const afterArchive = (await call<NetWorthResponse>(getNetWorth, '/net-worth')).body
    expect(afterArchive.latest?.netCents).toBe(-1_500_000)
    expect(afterArchive.assets.accounts).toEqual([])

    const loanParams = { manualAccountId: loan.id }
    const deleted = await call(deleteAccount, `/manual-accounts/${loan.id}`, { method: 'DELETE', params: loanParams })
    expect(deleted).toEqual({ status: 200, body: { manualAccountId: loan.id } })
    expect((await call(getAccount, `/manual-accounts/${loan.id}`, { params: loanParams })).status).toBe(404)
  })
})

describe('linked accounts', () => {
  it('values investments at their balance and orders debts by APR', async () => {
    const { owner } = await household()
    test.session = owner
    const store = new FakePlaidStore()
    const accessToken = 'access-networth-api'
    await createBankItem(owner, db, {
      environment: 'fake',
      plaidItemId: 'item-networth-api',
      institutionId: null,
      institutionName: 'Fake Bank',
      accessTokenEncrypted: accessToken,
    })
    store.put(accessToken, sampleFakePlaidItem(today()))
    const now = new Date()
    const plaid = createFakePlaidClient({ store, now: () => now, seed: false })
    const deps: BankRefreshDeps = { db, client: () => plaid, decrypt: sealed => sealed, now: () => now }
    await runBalanceSync(deps)
    await runLiabilitiesSync(deps)
    await runInvestmentsSync(deps)
    await runNetWorthSnapshots({ db, now })

    const worth = (await call<NetWorthResponse>(getNetWorth, '/net-worth')).body
    // Checking, savings and the brokerage balance, less the card and the student loan.
    expect(worth.latest).toMatchObject({
      assetsCents: 9_052_310,
      liabilitiesCents: -1_304_233,
      netCents: 7_748_077,
      accountCount: 5,
      staleAccountCount: 0,
    })
    expect(worth.assets.accounts.find(account => account.name === 'Brokerage')).toMatchObject({
      balanceCents: 6_420_000,
      typeLabel: 'Investments',
    })

    const { debts } = (await call<{ debts: Debt[] }>(listDebts, '/net-worth/debts')).body
    expect(debts.map(debt => [debt.name, debt.aprPercent, debt.balanceCents])).toEqual([
      ['Rewards card', 24.99, -184_233],
      ['Student loan', 5.5, -1_120_000],
    ])
    expect(debts[1]).toMatchObject({
      source: 'plaid',
      kind: 'student',
      minimumPaymentCents: 21_700,
      nextPaymentDueOn: addCalendarDays(today(), 20),
      originalPrincipalCents: 3_200_000,
    })

    // The holdings add up to $64,065, the balance says $64,200, and net worth used the balance.
    const composition = (await call<NetWorthComposition>(getComposition, '/net-worth/composition')).body
    expect(composition.totalCents).toBe(6_406_500)
    expect(composition.accounts).toMatchObject([
      { name: 'Brokerage', balanceCents: 6_420_000, holdingsValueCents: 6_406_500, change: null },
    ])
  })
})

describe('history typed in from old records', () => {
  it('takes days before tracking started, and nothing from then on', async () => {
    const { owner } = await household()
    test.session = owner

    const longAgo = addCalendarDays(today(), -400)
    const saved = await post<{ entry: NetWorthHistoryEntry }>(saveHistory, '/net-worth/history', {
      asOf: longAgo,
      assetsCents: 30_000_000,
      owedCents: 5_000_000,
    })
    expect(saved.status).toBe(201)
    expect(saved.body.entry).toMatchObject({ asOf: longAgo, assetsCents: 30_000_000, owedCents: 5_000_000, netCents: 25_000_000 })
    expect((await post(saveHistory, '/net-worth/history', { asOf: today(), assetsCents: 1, owedCents: 0 })).status).toBe(400)

    // The first measured day is today, taken when the account is added.
    await post(createAccount, '/manual-accounts', { name: 'Cash jar', kind: 'cash', value: { asOf: today(), valueCents: 100_000 } })
    const yesterday = addCalendarDays(today(), -1)
    expect((await post(saveHistory, '/net-worth/history', { asOf: yesterday, assetsCents: 20_000_000, owedCents: 0 })).status).toBe(201)
    expect((await post(saveHistory, '/net-worth/history', { asOf: today(), assetsCents: 20_000_000, owedCents: 0 })).status).toBe(400)

    const history = await call<Page<NetWorthHistoryEntry>>(listHistory, '/net-worth/history')
    expect(history.body.items.map(entry => entry.asOf)).toEqual([yesterday, longAgo])
    const worth = await call<NetWorthResponse>(getNetWorth, '/net-worth?range=ALL')
    expect(worth.status).toBe(200)
    expect(worth.body.latest).toMatchObject({ asOf: today(), netCents: 100_000 })

    const removed = await call(deleteHistory, `/net-worth/history/${saved.body.entry.id}`, {
      method: 'DELETE',
      params: { entryId: saved.body.entry.id },
    })
    expect(removed).toEqual({ status: 200, body: { entryId: saved.body.entry.id } })
    expect((await call<Page<NetWorthHistoryEntry>>(listHistory, '/net-worth/history')).body.items.map(entry => entry.asOf)).toEqual([
      yesterday,
    ])
  })
})

describe('who can see it', () => {
  it('is for owners and adults, not members, and never signed out', async () => {
    const home = await household()
    test.session = await home.join('adult')
    expect((await call(getNetWorth, '/net-worth')).status).toBe(200)
    expect((await post(createAccount, '/manual-accounts', { name: 'Car', kind: 'vehicle' })).status).toBe(201)

    test.session = await home.join('member')
    const reads: [Handler, string][] = [
      [getNetWorth, '/net-worth'],
      [getComposition, '/net-worth/composition'],
      [listDebts, '/net-worth/debts'],
      [listAccounts, '/manual-accounts'],
      [listHistory, '/net-worth/history'],
    ]
    for (const [handler, path] of reads) expect((await call(handler, path)).status, path).toBe(403)
    expect((await post(createAccount, '/manual-accounts', { name: 'Car', kind: 'vehicle' })).status).toBe(403)

    test.session = null
    expect((await call(getNetWorth, '/net-worth')).status).toBe(401)
  })
})
