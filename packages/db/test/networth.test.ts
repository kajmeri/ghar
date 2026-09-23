import type { PGlite } from '@electric-sql/pglite'
import type { RequestContext } from '@ghar/contracts'
import type { BankAccount, BankHolding, BankLiability } from '@ghar/core/banking'
import { ConflictError, ForbiddenError, NotFoundError } from '@ghar/core/errors'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { and, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { accountSnapshots, accounts, networthSnapshots, plaidItems } from '../src/schema'
import { applyBalanceSync, applyInvestmentsSync, applyLiabilitiesSync, createBankItem } from '../src/queries/banking'
import { createInvitation } from '../src/queries/invitations'
import { addManualValue, createManualAccount, listManualAccounts, updateManualAccount } from '../src/queries/manual-accounts'
import {
  deleteNetWorthHistory,
  getNetWorthTrackingStartedOn,
  listAccountSnapshotSeries,
  listHoldings,
  listHouseholdsForNetWorth,
  listInvestmentAccounts,
  listLiabilityDues,
  listLinkedDebts,
  listNetWorthAccountSnapshots,
  listNetWorthHistoryPage,
  listNetWorthSnapshots,
  saveNetWorthHistory,
  takeNetWorthSnapshot,
} from '../src/queries/networth'
import { acceptInvitation, createHousehold } from '../src/queries/session'
import type { Db, SystemContext } from '../src/queries/types'
import { createAuthUser, createTestDatabase, queryAs } from './support/database'

let client: PGlite
let db: Db
const users = { ownerA: '', memberA: '', ownerB: '' }
let a: RequestContext
let member: RequestContext
let b: RequestContext
let system: SystemContext
let itemId: string

const at = (day: string, time = '15:00') => new Date(`${day}T${time}:00Z`)

function bankAccount(name: string, type: string, currentBalanceCents: number | null): BankAccount {
  return {
    plaidAccountId: `acct-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    officialName: null,
    mask: '0001',
    type,
    subtype: null,
    currentBalanceCents,
    availableBalanceCents: null,
    isoCurrency: 'USD',
  }
}

const balances = {
  checking: bankAccount('Checking', 'depository', 250_000),
  card: bankAccount('Card', 'credit', 40_000),
  brokerage: bankAccount('Brokerage', 'investment', 900_000),
  loan: bankAccount('Student loan', 'loan', 1_200_000),
}
const allAccounts = () => Object.values(balances)

async function syncBalances(now: Date, list: readonly BankAccount[] = allAccounts()) {
  await applyBalanceSync(system, db, { itemId, accounts: list, now })
}

async function accountId(name: string): Promise<string> {
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.householdId, a.householdId), eq(accounts.name, name)))
  if (!row) throw new Error(`No ${name} account`)
  return row.id
}

async function day(ctx: RequestContext, asOf: string) {
  const rows = await db
    .select()
    .from(networthSnapshots)
    .where(and(eq(networthSnapshots.householdId, ctx.householdId), eq(networthSnapshots.asOf, asOf)))
  return rows
}

async function readings(asOf: string) {
  const rows = await listNetWorthAccountSnapshots(a, db, asOf)
  return Object.fromEntries(rows.map(row => [row.name, { balanceCents: row.balanceCents, isStale: row.isStale }]))
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  users.ownerA = await createAuthUser(client, 'owner-a@example.com')
  users.memberA = await createAuthUser(client, 'member-a@example.com')
  users.ownerB = await createAuthUser(client, 'owner-b@example.com')

  const householdA = await createHousehold({ userId: users.ownerA, email: 'owner-a@example.com' }, db, {
    name: 'Household A',
    timezone: 'America/Chicago',
    currency: 'USD',
  })
  a = { userId: users.ownerA, householdId: householdA.household.id, role: 'owner' }
  system = { householdId: a.householdId, userId: null }
  member = { userId: users.memberA, householdId: a.householdId, role: 'member' }

  const householdB = await createHousehold({ userId: users.ownerB, email: 'owner-b@example.com' }, db, {
    name: 'Household B',
    timezone: 'UTC',
    currency: 'USD',
  })
  b = { userId: users.ownerB, householdId: householdB.household.id, role: 'owner' }

  await createInvitation(a, db, {
    email: 'member-a@example.com',
    role: 'member',
    tokenHash: 'hash-member-a',
    expiresAt: invitationExpiresAt(at('2026-09-01')),
  })
  await acceptInvitation({ userId: users.memberA, email: 'member-a@example.com' }, db, {
    tokenHash: 'hash-member-a',
    now: at('2026-09-01'),
  })

  const item = await createBankItem(a, db, {
    environment: 'fake',
    plaidItemId: 'item-a',
    institutionId: null,
    institutionName: 'Test Bank',
    accessTokenEncrypted: 'v1:test:test:test',
  })
  itemId = item.id
})

describe('the daily snapshot', () => {
  it('writes one signed reading per account and one row for the day, however often it runs', async () => {
    await syncBalances(at('2026-09-10'))
    const first = await takeNetWorthSnapshot(system, db, { today: '2026-09-10', now: at('2026-09-10') })
    const second = await takeNetWorthSnapshot(system, db, { today: '2026-09-10', now: at('2026-09-10', '16:00') })

    expect(first).toEqual({ taken: true, accountCount: 4, staleAccountCount: 0 })
    expect(second).toEqual(first)
    expect(await readings('2026-09-10')).toEqual({
      Checking: { balanceCents: 250_000, isStale: false },
      Card: { balanceCents: -40_000, isStale: false },
      Brokerage: { balanceCents: 900_000, isStale: false },
      'Student loan': { balanceCents: -1_200_000, isStale: false },
    })
    const rows = await day(a, '2026-09-10')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      assetsCents: 1_150_000,
      liabilitiesCents: -1_240_000,
      netCents: -90_000,
      accountCount: 4,
      staleAccountCount: 0,
      source: 'automatic',
    })
    const accountRows = await db.select().from(accountSnapshots).where(eq(accountSnapshots.asOf, '2026-09-10'))
    expect(accountRows).toHaveLength(4)
    expect(accountRows.every(row => row.source === 'plaid')).toBe(true)
  })

  it('carries a balance older than 36 hours forward and flags it, rather than writing zero', async () => {
    // Synced at 15:00 on the 10th. At 04:00 on the 12th that's 37 hours.
    const run = await takeNetWorthSnapshot(system, db, { today: '2026-09-11', now: at('2026-09-12', '04:00') })
    expect(run).toEqual({ taken: true, accountCount: 4, staleAccountCount: 4 })
    expect(await readings('2026-09-11')).toMatchObject({
      Checking: { balanceCents: 250_000, isStale: true },
      Card: { balanceCents: -40_000, isStale: true },
    })
    expect((await day(a, '2026-09-11'))[0]).toMatchObject({ netCents: -90_000, staleAccountCount: 4 })
  })

  it('treats a bank that needs signing in again as stale, and falls back to the last snapshot', async () => {
    await syncBalances(at('2026-09-12'))
    await db.update(plaidItems).set({ status: 'login_required' }).where(eq(plaidItems.id, itemId))
    await db
      .update(accounts)
      .set({ currentBalanceCents: null })
      .where(eq(accounts.id, await accountId('Card')))

    const run = await takeNetWorthSnapshot(system, db, { today: '2026-09-12', now: at('2026-09-12') })

    expect(run).toEqual({ taken: true, accountCount: 4, staleAccountCount: 4 })
    // The card lost its balance, so the reading from the 11th carries.
    expect((await readings('2026-09-12')).Card).toEqual({ balanceCents: -40_000, isStale: true })
    expect((await day(a, '2026-09-12'))[0]).toMatchObject({ netCents: -90_000 })
  })

  it('clears the connection error on a successful balance sync', async () => {
    await syncBalances(at('2026-09-13'))
    const [item] = await db.select({ status: plaidItems.status }).from(plaidItems).where(eq(plaidItems.id, itemId))
    expect(item?.status).toBe('good')
    expect(await takeNetWorthSnapshot(system, db, { today: '2026-09-13', now: at('2026-09-13') })).toEqual({
      taken: true,
      accountCount: 4,
      staleAccountCount: 0,
    })
  })

  it('removes a reading for an account hidden since the first run that day', async () => {
    const brokerage = await accountId('Brokerage')
    await db.update(accounts).set({ isHidden: true }).where(eq(accounts.id, brokerage))
    const run = await takeNetWorthSnapshot(system, db, { today: '2026-09-13', now: at('2026-09-13', '18:00') })
    await db.update(accounts).set({ isHidden: false }).where(eq(accounts.id, brokerage))

    expect(run.accountCount).toBe(3)
    expect(Object.keys(await readings('2026-09-13')).sort()).toEqual(['Card', 'Checking', 'Student loan'])
    expect((await day(a, '2026-09-13'))[0]).toMatchObject({ assetsCents: 250_000, netCents: -990_000, accountCount: 3 })
  })

  it('counts an overdrawn account as owed, so the day still adds up', async () => {
    await syncBalances(at('2026-09-14'), [
      { ...balances.checking, currentBalanceCents: -3_000 },
      balances.card,
      balances.brokerage,
      balances.loan,
    ])
    await takeNetWorthSnapshot(system, db, { today: '2026-09-14', now: at('2026-09-14') })
    expect((await day(a, '2026-09-14'))[0]).toMatchObject({
      assetsCents: 900_000,
      liabilitiesCents: -1_243_000,
      netCents: -343_000,
    })
    await syncBalances(at('2026-09-14'))
  })

  it('stops reading a connection the household turned off, and leaves the days before it alone', async () => {
    // What a disconnect does to the row: the token is revoked, so there is nothing left to read.
    await db.update(plaidItems).set({ status: 'disconnected', accessTokenEncrypted: null }).where(eq(plaidItems.id, itemId))

    const run = await takeNetWorthSnapshot(system, db, { today: '2026-09-14', now: at('2026-09-14', '21:00') })
    expect(run).toEqual({ taken: false, accountCount: 0, staleAccountCount: 0 })
    expect(await readings('2026-09-14')).toEqual({})
    expect(await day(a, '2026-09-14')).toEqual([])
    // The days it was connected for are history, and history doesn't change.
    expect(Object.keys(await readings('2026-09-13')).sort()).toEqual(['Card', 'Checking', 'Student loan'])

    // Connecting the bank again picks the readings back up from that day on.
    await db.update(plaidItems).set({ status: 'good' }).where(eq(plaidItems.id, itemId))
    expect(await takeNetWorthSnapshot(system, db, { today: '2026-09-14', now: at('2026-09-14') })).toEqual({
      taken: true,
      accountCount: 4,
      staleAccountCount: 0,
    })
  })

  it('counts manual accounts at their newest value on or before the day, and skips archived ones', async () => {
    const house = await createManualAccount(
      a,
      db,
      { name: 'House', kind: 'property', notes: null, reminderCadenceMonths: 6, isLiability: false },
      { asOf: '2026-01-15', valueCents: 45_000_000, source: 'estimate', notes: null }
    )
    await addManualValue(a, db, house.id, { asOf: '2026-10-01', valueCents: 47_000_000, source: 'estimate', notes: null })
    await createManualAccount(
      a,
      db,
      { name: 'Car loan', kind: 'loan', notes: null, reminderCadenceMonths: null, isLiability: true },
      { asOf: '2026-09-01', valueCents: 1_500_000, source: 'manual', notes: null }
    )
    const oldCar = await createManualAccount(
      a,
      db,
      { name: 'Old car', kind: 'vehicle', notes: null, reminderCadenceMonths: null, isLiability: false },
      { asOf: '2026-02-01', valueCents: 800_000, source: 'estimate', notes: null }
    )
    await updateManualAccount(a, db, oldCar.id, {
      name: 'Old car',
      kind: 'vehicle',
      notes: null,
      reminderCadenceMonths: null,
      isLiability: false,
      archived: true,
    })
    await createManualAccount(
      a,
      db,
      { name: 'Unvalued', kind: 'crypto', notes: null, reminderCadenceMonths: null, isLiability: false },
      null
    )

    const run = await takeNetWorthSnapshot(system, db, { today: '2026-09-15', now: at('2026-09-14', '20:00') })

    expect(run).toEqual({ taken: true, accountCount: 6, staleAccountCount: 0 })
    const reading = await readings('2026-09-15')
    expect(reading.House).toEqual({ balanceCents: 45_000_000, isStale: false })
    expect(reading['Car loan']).toEqual({ balanceCents: -1_500_000, isStale: false })
    expect(reading['Old car']).toBeUndefined()
    expect(reading.Unvalued).toBeUndefined()
    // The account list shows the newest value overall, including one dated after the snapshot.
    const [listedHouse] = (await listManualAccounts(a, db, { includeArchived: false })).filter(row => row.name === 'House')
    expect(listedHouse).toMatchObject({ latestValueCents: 47_000_000, latestValueOn: '2026-10-01', latestValueSource: 'estimate' })
    const listed = await listNetWorthAccountSnapshots(a, db, '2026-09-15')
    expect(listed.find(row => row.name === 'House')).toMatchObject({ source: 'manual', type: 'property', valueOn: '2026-01-15' })
    expect(listed.find(row => row.name === 'Checking')).toMatchObject({ source: 'plaid', institutionName: 'Test Bank', mask: '0001' })
    expect((await day(a, '2026-09-15'))[0]).toMatchObject({
      assetsCents: 46_150_000,
      liabilitiesCents: -2_740_000,
      netCents: 43_410_000,
    })
  })

  it('writes nothing for a household with nothing to count', async () => {
    expect(await takeNetWorthSnapshot(b, db, { today: '2026-09-15', now: at('2026-09-15') })).toEqual({
      taken: false,
      accountCount: 0,
      staleAccountCount: 0,
    })
    expect(await listNetWorthSnapshots(b, db)).toEqual([])
    const households = await listHouseholdsForNetWorth(db)
    expect(households.map(row => row.id)).toEqual([a.householdId])
    expect(households[0]?.timezone).toBe('America/Chicago')
  })

  it('reads the series oldest first and knows when tracking started', async () => {
    const series = await listNetWorthSnapshots(a, db)
    expect(series.map(row => row.asOf)).toEqual(['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15'])
    expect(await getNetWorthTrackingStartedOn(a, db)).toBe('2026-09-10')
    expect(await getNetWorthTrackingStartedOn(b, db)).toBeNull()

    const brokerage = await listAccountSnapshotSeries(a, db, { accountIds: [await accountId('Brokerage')], from: '2026-09-12' })
    expect(brokerage.map(row => row.asOf)).toEqual(['2026-09-12', '2026-09-14', '2026-09-15'])
    expect(await listAccountSnapshotSeries(a, db, { accountIds: [], from: '2026-09-01' })).toEqual([])
  })
})

describe('history typed in by hand', () => {
  it('saves a day before tracking began, replaces it on a second save, and never replaces a measured day', async () => {
    const saved = await saveNetWorthHistory(a, db, {
      asOf: '2025-03-01',
      assetsCents: 30_000_000,
      liabilitiesCents: -2_000_000,
      netCents: 28_000_000,
    })
    expect(saved).toMatchObject({ source: 'manual', accountCount: 0, staleAccountCount: 0 })
    const replaced = await saveNetWorthHistory(a, db, {
      asOf: '2025-03-01',
      assetsCents: 31_000_000,
      liabilitiesCents: -2_000_000,
      netCents: 29_000_000,
    })
    expect(replaced.id).toBe(saved.id)
    expect(replaced.netCents).toBe(29_000_000)

    await expect(
      saveNetWorthHistory(a, db, { asOf: '2026-09-10', assetsCents: 1, liabilitiesCents: 0, netCents: 1 })
    ).rejects.toBeInstanceOf(ConflictError)
    expect((await day(a, '2026-09-10'))[0]).toMatchObject({ source: 'automatic', netCents: -90_000 })

    // The job never writes over a typed-in day, or leaves readings behind for one.
    expect(await takeNetWorthSnapshot(system, db, { today: '2025-03-01', now: at('2026-09-15') })).toMatchObject({ taken: false })
    expect((await day(a, '2025-03-01'))[0]).toMatchObject({ source: 'manual', netCents: 29_000_000 })
    expect(await readings('2025-03-01')).toEqual({})
    expect(await getNetWorthTrackingStartedOn(a, db)).toBe('2026-09-10')
  })

  it('lists and deletes typed-in days only', async () => {
    await saveNetWorthHistory(a, db, { asOf: '2024-03-01', assetsCents: 20_000_000, liabilitiesCents: 0, netCents: 20_000_000 })
    const page = await listNetWorthHistoryPage(a, db, { limit: 1 })
    expect(page.rows.map(row => row.asOf)).toEqual(['2025-03-01'])
    expect(page.next).not.toBeNull()

    const [automatic] = await day(a, '2026-09-10')
    await expect(deleteNetWorthHistory(a, db, automatic?.id ?? '')).rejects.toBeInstanceOf(NotFoundError)

    const entry = page.rows[0]
    if (!entry) throw new Error('No entry')
    await expect(deleteNetWorthHistory(b, db, entry.id)).rejects.toBeInstanceOf(NotFoundError)
    await deleteNetWorthHistory(a, db, entry.id)
    expect((await listNetWorthHistoryPage(a, db, { limit: 10 })).rows.map(row => row.asOf)).toEqual(['2024-03-01'])
  })
})

describe('investments and liabilities', () => {
  const holding = (plaidSecurityId: string, fields: Partial<BankHolding>): BankHolding => ({
    plaidAccountId: balances.brokerage.plaidAccountId,
    plaidSecurityId,
    ticker: plaidSecurityId.toUpperCase(),
    name: plaidSecurityId,
    securityType: 'etf',
    quantity: 10,
    costBasisCents: null,
    valueCents: 100_000,
    asOf: '2026-09-15',
    ...fields,
  })

  const liability = (account: BankAccount, fields: Partial<BankLiability>): BankLiability => ({
    plaidAccountId: account.plaidAccountId,
    kind: 'credit',
    aprPercent: null,
    minimumPaymentCents: null,
    nextPaymentDueOn: null,
    lastPaymentCents: null,
    lastPaymentOn: null,
    originationDate: null,
    originalPrincipalCents: null,
    isOverdue: false,
    ...fields,
  })

  it('replaces holdings on every sync and keeps them out of the balance', async () => {
    const now = at('2026-09-15')
    expect(
      await applyInvestmentsSync(system, db, {
        itemId,
        accounts: [balances.brokerage],
        holdings: [
          holding('vti', { quantity: 20.5, valueCents: 600_000, costBasisCents: 400_000 }),
          holding('bnd', { securityType: 'fixed income', valueCents: 300_000 }),
        ],
        now,
      })
    ).toEqual({ accounts: 1, holdings: 2 })
    await applyInvestmentsSync(system, db, {
      itemId,
      accounts: [balances.brokerage],
      holdings: [holding('vti', { quantity: 21.25, valueCents: 650_000, costBasisCents: 410_000 })],
      now,
    })

    const held = await listHoldings(a, db)
    expect(held).toHaveLength(1)
    expect(held[0]).toMatchObject({ ticker: 'VTI', quantity: 21.25, valueCents: 650_000, costBasisCents: 410_000 })
    const [investment] = await listInvestmentAccounts(a, db)
    expect(investment).toMatchObject({ name: 'Brokerage', currentBalanceCents: 900_000 })

    await expect(
      applyInvestmentsSync(system, db, {
        itemId,
        accounts: [balances.brokerage],
        holdings: [holding('vti', { plaidAccountId: 'acct-somewhere-else' })],
        now,
      })
    ).rejects.toThrow('unknown account')
    expect(await listHoldings(a, db)).toHaveLength(1)
  })

  it('stores what /liabilities/get adds, removes what it stops describing, and lists dues', async () => {
    const now = at('2026-09-15')
    await applyLiabilitiesSync(system, db, {
      itemId,
      accounts: [balances.card, balances.loan],
      liabilities: [
        liability(balances.card, { aprPercent: 24.99, minimumPaymentCents: 3_500, nextPaymentDueOn: '2026-09-18' }),
        liability(balances.loan, {
          kind: 'student',
          aprPercent: 5.5,
          minimumPaymentCents: 21_000,
          nextPaymentDueOn: '2026-10-01',
          originalPrincipalCents: 3_000_000,
        }),
      ],
      now,
    })

    const debts = await listLinkedDebts(a, db)
    expect(debts.map(debt => [debt.name, debt.kind, debt.aprPercent]).sort()).toEqual([
      ['Card', 'credit', 24.99],
      ['Student loan', 'student', 5.5],
    ])
    expect((await listLiabilityDues(a, db, { from: '2026-09-15', to: '2026-09-22' })).map(due => [due.name, due.nextPaymentDueOn])).toEqual(
      [['Card', '2026-09-18']]
    )

    await applyLiabilitiesSync(system, db, {
      itemId,
      accounts: [balances.card, balances.loan],
      liabilities: [liability(balances.card, { aprPercent: 26.99, minimumPaymentCents: 3_500, nextPaymentDueOn: '2026-10-18' })],
      now,
    })
    const after = await listLinkedDebts(a, db)
    // The loan is still owed; it just has no detail now.
    expect(after.find(debt => debt.name === 'Student loan')).toMatchObject({ kind: null, aprPercent: null, isOverdue: false })
    expect(after.find(debt => debt.name === 'Card')).toMatchObject({ aprPercent: 26.99, nextPaymentDueOn: '2026-10-18' })
    expect(await listLiabilityDues(a, db, { from: '2026-09-15', to: '2026-09-22' })).toEqual([])
  })
})

describe('access', () => {
  it('keeps every net worth read and write from members', async () => {
    const calls = [
      () => takeNetWorthSnapshot(member, db, { today: '2026-09-15', now: at('2026-09-15') }),
      () => listNetWorthSnapshots(member, db),
      () => getNetWorthTrackingStartedOn(member, db),
      () => listNetWorthAccountSnapshots(member, db, '2026-09-15'),
      () => listHoldings(member, db),
      () => listInvestmentAccounts(member, db),
      () => listLinkedDebts(member, db),
      () => listLiabilityDues(member, db, { from: '2026-09-01', to: '2026-12-31' }),
      () => listNetWorthHistoryPage(member, db, { limit: 10 }),
      () => saveNetWorthHistory(member, db, { asOf: '2024-01-01', assetsCents: 1, liabilitiesCents: 0, netCents: 1 }),
    ]
    for (const call of calls) await expect(call()).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('shows another household none of it', async () => {
    expect(await listNetWorthAccountSnapshots(b, db, '2026-09-15')).toEqual([])
    expect(await listHoldings(b, db)).toEqual([])
    expect(await listLinkedDebts(b, db)).toEqual([])
    expect(await listInvestmentAccounts(b, db)).toEqual([])
  })

  it('shows the authenticated role only its own household, and members nothing', async () => {
    for (const table of ['manual_accounts', 'manual_values', 'account_snapshots', 'networth_snapshots', 'holdings', 'liability_details']) {
      expect((await queryAs(client, users.ownerA, `select 1 from ${table}`)).length, table).toBeGreaterThan(0)
      expect(await queryAs(client, users.memberA, `select 1 from ${table}`), table).toEqual([])
      expect(await queryAs(client, users.ownerB, `select 1 from ${table}`), table).toEqual([])
      expect(await queryAs(client, null, `select 1 from ${table}`), table).toEqual([])
    }
  })
})
