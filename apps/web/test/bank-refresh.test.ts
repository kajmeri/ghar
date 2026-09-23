import type { PGlite } from '@electric-sql/pglite'
import type { BankAccount } from '@ghar/core/banking'
import {
  createBankItem,
  createHousehold,
  disconnectBankItem,
  listAccounts,
  listBankItems,
  listHoldings,
  listLinkedDebts,
  listNetWorthAccountSnapshots,
  listNetWorthSnapshots,
  type Db,
  type RequestContext,
} from '@ghar/db/queries'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import {
  ACCESS_TOKEN_UNREADABLE,
  runBalanceSync,
  runInvestmentsSync,
  runLiabilitiesSync,
  type BankRefreshDeps,
  type BankRefreshResult,
} from '@/lib/banking/refresh'
import { DecryptionError } from '@/lib/crypto'
import { runNetWorthSnapshots } from '@/lib/networth/snapshots'
import { createFakePlaidClient, FakePlaidStore, sampleFakePlaidItem, type FakePlaidItem } from '@/lib/providers/plaid/fake'

// The daily bank jobs and the net worth snapshot after them, against a real schema and the in-memory
// Plaid. The jobs read every connection in the database, so each test starts from an empty one.

const NOW = new Date('2026-09-14T15:00:00Z')
const TODAY = '2026-09-14'
const NEXT_DAY = new Date('2026-09-15T15:00:00Z')

let client: PGlite
let db: Db

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
})

beforeEach(async () => {
  await client.exec('truncate households, plaid_items cascade')
})

afterEach(() => {
  vi.restoreAllMocks()
})

let people = 0

async function household(): Promise<RequestContext> {
  people += 1
  const email = `owner-${String(people)}@example.com`
  const userId = await createAuthUser(client, email)
  const { household: created } = await createHousehold({ userId, email }, db, {
    name: `Household ${String(people)}`,
    timezone: 'America/New_York',
    currency: 'USD',
  })
  return { userId, householdId: created.id, role: 'owner' }
}

let connections = 0

/** A fake connection holding `item`. Tests skip encryption, so the stored token is the token. */
async function connect(ctx: RequestContext, store: FakePlaidStore, item: FakePlaidItem): Promise<{ itemId: string; accessToken: string }> {
  connections += 1
  const n = String(connections)
  const accessToken = `access-fake-${n}`
  const row = await createBankItem(ctx, db, {
    environment: 'fake',
    plaidItemId: `item-${n}`,
    institutionId: null,
    institutionName: `Bank ${n}`,
    accessTokenEncrypted: accessToken,
  })
  store.put(accessToken, item)
  return { itemId: row.id, accessToken }
}

function deps(store: FakePlaidStore, now = NOW, overrides: Partial<BankRefreshDeps> = {}): BankRefreshDeps {
  const plaid = createFakePlaidClient({ store, now: () => now, seed: false })
  return { db, client: () => plaid, decrypt: sealed => sealed, now: () => now, ...overrides }
}

function result(counts: Partial<BankRefreshResult>): BankRefreshResult {
  return { items: 0, synced: 0, skipped: 0, unavailable: 0, loginRequired: 0, errors: 0, ...counts }
}

function bankAccount(plaidAccountId: string, name: string, type: string, subtype: string, balanceCents: number): BankAccount {
  return {
    plaidAccountId,
    name,
    officialName: null,
    mask: '0001',
    type,
    subtype,
    currentBalanceCents: balanceCents,
    availableBalanceCents: null,
    isoCurrency: 'USD',
  }
}

const checkingOnly = (): FakePlaidItem => ({
  accounts: [bankAccount('checking', 'Checking', 'depository', 'checking', 250_000)],
  liabilities: null,
  holdings: null,
})

async function itemState(ctx: RequestContext) {
  const [item] = await listBankItems(ctx, db)
  return { status: item?.status, errorCode: item?.errorCode }
}

describe('daily bank refresh', () => {
  it('brings in balances first, then liability details and holdings for the connections that have them', async () => {
    const store = new FakePlaidStore()
    const ctx = await household()
    await connect(ctx, store, sampleFakePlaidItem(TODAY))
    const run = deps(store)

    // Nothing is known about a new connection's accounts until its balances arrive.
    expect(await runLiabilitiesSync(run)).toEqual(result({}))
    expect(store.calls).toEqual([])

    expect(await runBalanceSync(run)).toEqual(result({ items: 1, synced: 1 }))
    expect(await runLiabilitiesSync(run)).toEqual(result({ items: 1, synced: 1 }))
    expect(await runInvestmentsSync(run)).toEqual(result({ items: 1, synced: 1 }))
    expect(store.calls.map(call => call.method)).toEqual(['accounts', 'liabilities', 'holdings'])

    // Stored as Plaid reports them: what's owed stays positive on the account.
    const accounts = await listAccounts(ctx, db)
    expect(Object.fromEntries(accounts.map(account => [account.name, account.currentBalanceCents]))).toEqual({
      'Everyday checking': 482_310,
      'High-yield savings': 2_150_000,
      'Rewards card': 184_233,
      'Student loan': 1_120_000,
      Brokerage: 6_420_000,
    })

    const debts = (await listLinkedDebts(ctx, db)).toSorted((a, b) => a.name.localeCompare(b.name))
    expect(
      debts.map(({ name, kind, aprPercent, minimumPaymentCents, nextPaymentDueOn, originalPrincipalCents }) => ({
        name,
        kind,
        aprPercent,
        minimumPaymentCents,
        nextPaymentDueOn,
        originalPrincipalCents,
      }))
    ).toEqual([
      {
        name: 'Rewards card',
        kind: 'credit',
        aprPercent: 24.99,
        minimumPaymentCents: 4_000,
        nextPaymentDueOn: '2026-09-26',
        originalPrincipalCents: null,
      },
      {
        name: 'Student loan',
        kind: 'student',
        aprPercent: 5.5,
        minimumPaymentCents: 21_700,
        nextPaymentDueOn: '2026-10-04',
        originalPrincipalCents: 3_200_000,
      },
    ])

    const brokerage = accounts.find(account => account.name === 'Brokerage')
    const holdings = await listHoldings(ctx, db)
    expect(holdings).toHaveLength(5)
    expect(holdings.every(holding => holding.accountId === brokerage?.id)).toBe(true)
    expect(holdings.find(holding => holding.ticker === 'AAPL')?.costBasisCents).toBeNull()
    // The positions don't add up to the balance, and the balance is what counts.
    expect(holdings.reduce((sum, holding) => sum + holding.valueCents, 0)).toBe(6_406_500)

    expect(await runNetWorthSnapshots({ db, now: NOW })).toEqual({
      households: 1,
      taken: 1,
      empty: 0,
      accounts: 5,
      staleAccounts: 0,
      errors: 0,
    })
    expect(await listNetWorthSnapshots(ctx, db)).toEqual([
      {
        asOf: TODAY,
        source: 'automatic',
        assetsCents: 9_052_310,
        liabilitiesCents: -1_304_233,
        netCents: 7_748_077,
        accountCount: 5,
        staleAccountCount: 0,
      },
    ])
    const readings = await listNetWorthAccountSnapshots(ctx, db, TODAY)
    expect(readings.find(reading => reading.name === 'Brokerage')?.balanceCents).toBe(6_420_000)
    expect(readings.find(reading => reading.name === 'Rewards card')?.balanceCents).toBe(-184_233)
  })

  it('asks only for the products a connection has accounts for', async () => {
    const store = new FakePlaidStore()
    const ctx = await household()
    const { accessToken } = await connect(ctx, store, checkingOnly())
    const run = deps(store)

    await runBalanceSync(run)
    expect(await runLiabilitiesSync(run)).toEqual(result({}))
    expect(await runInvestmentsSync(run)).toEqual(result({}))

    expect(store.calls).toEqual([{ method: 'accounts', accessToken }])
  })

  it('leaves a connection as it is when its institution doesn’t offer the product', async () => {
    const store = new FakePlaidStore()
    const ctx = await household()
    await connect(ctx, store, {
      accounts: [bankAccount('card', 'Card', 'credit', 'credit card', 90_000), bankAccount('ira', 'IRA', 'investment', 'ira', 1_500_000)],
      liabilities: null,
      holdings: null,
    })
    const run = deps(store)

    await runBalanceSync(run)
    expect(await runLiabilitiesSync(run)).toEqual(result({ items: 1, unavailable: 1 }))
    expect(await runInvestmentsSync(run)).toEqual(result({ items: 1, unavailable: 1 }))

    expect(await itemState(ctx)).toEqual({ status: 'good', errorCode: null })
    expect(await listHoldings(ctx, db)).toEqual([])
  })

  it('stops syncing a connection that needs signing in again, and carries its balances forward as stale', async () => {
    const store = new FakePlaidStore()
    const ctx = await household()
    const { accessToken } = await connect(ctx, store, sampleFakePlaidItem(TODAY))
    await runBalanceSync(deps(store))
    await runNetWorthSnapshots({ db, now: NOW })

    store.fail(accessToken, 'ITEM_LOGIN_REQUIRED')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const nextDay = deps(store, NEXT_DAY)
    expect(await runBalanceSync(nextDay)).toEqual(result({ items: 1, loginRequired: 1 }))
    expect(await itemState(ctx)).toEqual({ status: 'login_required', errorCode: 'ITEM_LOGIN_REQUIRED' })
    expect(warn.mock.calls.flat().map(String).join(' ')).not.toContain(accessToken)

    // Until someone reconnects, no job asks Plaid about it.
    const asked = store.calls.length
    expect(await runBalanceSync(nextDay)).toEqual(result({ items: 1, skipped: 1 }))
    expect(await runLiabilitiesSync(nextDay)).toEqual(result({ items: 1, skipped: 1 }))
    expect(await runInvestmentsSync(nextDay)).toEqual(result({ items: 1, skipped: 1 }))
    expect(store.calls).toHaveLength(asked)

    // Twice on one day rewrites the day rather than adding to it.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(await runNetWorthSnapshots({ db, now: NEXT_DAY })).toEqual({
        households: 1,
        taken: 1,
        empty: 0,
        accounts: 5,
        staleAccounts: 5,
        errors: 0,
      })
    }
    const series = await listNetWorthSnapshots(ctx, db)
    expect(series.map(day => [day.asOf, day.netCents, day.staleAccountCount])).toEqual([
      [TODAY, 7_748_077, 0],
      ['2026-09-15', 7_748_077, 5],
    ])
    const readings = await listNetWorthAccountSnapshots(ctx, db, '2026-09-15')
    expect(readings).toHaveLength(5)
    expect(readings.every(reading => reading.isStale)).toBe(true)
  })

  it('leaves a connection the household turned off out of every job, and stops counting its accounts', async () => {
    const store = new FakePlaidStore()
    const ctx = await household()
    await connect(ctx, store, checkingOnly())
    expect(await runBalanceSync(deps(store))).toEqual(result({ items: 1, synced: 1 }))
    await runNetWorthSnapshots({ db, now: NOW })

    const [item] = await listBankItems(ctx, db)
    if (!item) throw new Error('no connection')
    await disconnectBankItem(ctx, db, { itemId: item.id, now: NOW })

    // The jobs still see the connection; none of them asks Plaid about it again.
    const asked = store.calls.length
    const nextDay = deps(store, NEXT_DAY)
    expect(await runBalanceSync(nextDay)).toEqual(result({ items: 1, skipped: 1 }))
    expect(await runLiabilitiesSync(nextDay)).toEqual(result({}))
    expect(await runInvestmentsSync(nextDay)).toEqual(result({}))
    expect(store.calls).toHaveLength(asked)

    // Its balance stops being a reading, so the day has nothing to count rather than a stale figure.
    expect(await runNetWorthSnapshots({ db, now: NEXT_DAY })).toMatchObject({ households: 1, taken: 0, empty: 1, accounts: 0 })
    expect(await listNetWorthAccountSnapshots(ctx, db, '2026-09-15')).toHaveLength(0)
    // The day it was connected for keeps its reading.
    expect(await listNetWorthAccountSnapshots(ctx, db, TODAY)).toHaveLength(1)
    // And the account is still there, for whoever wants to look at what it held.
    expect(await listAccounts(ctx, db)).toHaveLength(1)
  })

  it('retries after Plaid trouble, and records trouble with the connection until a sync succeeds', async () => {
    const store = new FakePlaidStore()
    const ctx = await household()
    const { accessToken } = await connect(ctx, store, checkingOnly())
    const run = deps(store)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    store.fail(accessToken, 'PRODUCT_NOT_READY')
    expect(await runBalanceSync(run)).toEqual(result({ items: 1, errors: 1 }))
    expect(await itemState(ctx)).toEqual({ status: 'good', errorCode: null })

    store.fail(accessToken, 'INSTITUTION_DOWN')
    expect(await runBalanceSync(run)).toEqual(result({ items: 1, errors: 1 }))
    expect(await itemState(ctx)).toEqual({ status: 'error', errorCode: 'INSTITUTION_DOWN' })

    store.recover(accessToken)
    expect(await runBalanceSync(run)).toEqual(result({ items: 1, synced: 1 }))
    expect(await itemState(ctx)).toEqual({ status: 'good', errorCode: null })
  })

  it('marks a connection whose access token can’t be opened, without asking Plaid', async () => {
    const store = new FakePlaidStore()
    const ctx = await household()
    const { accessToken } = await connect(ctx, store, checkingOnly())
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const run = deps(store, NOW, {
      decrypt: () => {
        throw new DecryptionError('The value could not be decrypted')
      },
    })

    expect(await runBalanceSync(run)).toEqual(result({ items: 1, errors: 1 }))

    expect(store.calls).toEqual([])
    expect(await itemState(ctx)).toEqual({ status: 'error', errorCode: ACCESS_TOKEN_UNREADABLE })
    expect(logged.mock.calls.flat().map(String).join(' ')).not.toContain(accessToken)
  })

  it('goes on to the next connection when one fails', async () => {
    const store = new FakePlaidStore()
    const ctx = await household()
    const broken = await connect(ctx, store, sampleFakePlaidItem(TODAY))
    await connect(ctx, store, checkingOnly())
    store.fail(broken.accessToken, 'INSTITUTION_DOWN')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(await runBalanceSync(deps(store))).toEqual(result({ items: 2, synced: 1, errors: 1 }))
    expect((await listAccounts(ctx, db)).map(account => account.name)).toEqual(['Checking'])
  })

  it('skips connections this deployment has no Plaid client for', async () => {
    const store = new FakePlaidStore()
    const ctx = await household()
    await connect(ctx, store, checkingOnly())

    expect(await runBalanceSync(deps(store, NOW, { client: () => null }))).toEqual(result({ items: 1, skipped: 1 }))

    expect(store.calls).toEqual([])
    expect(await itemState(ctx)).toEqual({ status: 'good', errorCode: null })
    // Nothing synced, so the snapshot has nothing to count and writes no zero for the chart to draw.
    expect(await runNetWorthSnapshots({ db, now: NOW })).toEqual({
      households: 0,
      taken: 0,
      empty: 0,
      accounts: 0,
      staleAccounts: 0,
      errors: 0,
    })
    expect(await listNetWorthSnapshots(ctx, db)).toEqual([])
  })
})
