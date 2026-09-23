import { requirePermission } from '@ghar/core/auth'
import type { CalendarDate } from '@ghar/core/dates'
import { ConflictError, NotFoundError } from '@ghar/core/errors'
import {
  BALANCE_SIGN,
  planLinkedAccountSnapshot,
  planManualAccountSnapshot,
  summarizeReadings,
  type LiabilityKind,
  type NetWorthSnapshot,
  type PlannedAccountSnapshot,
} from '@ghar/core/finances'
import { and, asc, eq, getTableColumns, gte, inArray, isNull, lte, notInArray, or, sql, type SQL } from 'drizzle-orm'
import {
  accountSnapshots,
  accounts,
  holdings,
  households,
  liabilityDetails,
  manualAccounts,
  manualValues,
  networthSnapshots,
  plaidItems,
  transactions,
} from '../schema'
import { recordAudit } from './audit'
import { authorize } from './authorize'
import { keysetAfter, keysetOrder, pageKeys, toPage, type Keyset, type Page, type PageRequest } from './pagination'
import type { Actor, Db, RequestContext } from './types'

// Net worth, day by day. The daily job writes one signed account_snapshots row per account and rolls
// them up into networth_snapshots; everything that reads them trusts the stored sign. Hidden accounts
// are left out everywhere, as they are from spending, so a duplicate connection never counts twice.
// Every read here needs finances.view: members never see these figures.

/** Plaid's account types whose holdings make up the composition panel. */
export const INVESTMENT_ACCOUNT_TYPES = ['investment', 'brokerage'] as const

function excluded(column: string) {
  return sql.raw(`excluded.${column}`)
}

// ---------------------------------------------------------------------------------------------
// The daily snapshot

export interface NetWorthSnapshotRun {
  /** False when the household has nothing to count yet, so no row was written. */
  taken: boolean
  accountCount: number
  staleAccountCount: number
}

/**
 * Takes the household's snapshot for `today`: one reading per visible connected account and per
 * active manual account, then the day's totals. Balances that couldn't be refreshed are carried
 * forward and flagged, never zeroed or skipped. Running it again the same day updates both tables in
 * place, and removes readings for accounts hidden or archived since. A household with no readings
 * gets no row, so the page can say tracking hasn't started instead of drawing a zero. A day typed in
 * by hand is never overwritten.
 */
export async function takeNetWorthSnapshot(actor: Actor, db: Db, input: { today: CalendarDate; now: Date }): Promise<NetWorthSnapshotRun> {
  authorize(actor, 'finances.manage')
  const { today, now } = input
  return db.transaction(async tx => {
    // Two runs for one household (the cron and a manual edit) apply one after the other.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ghar.networth_snapshot.${actor.householdId}`}))`)
    const [typedIn] = await tx
      .select({ id: networthSnapshots.id })
      .from(networthSnapshots)
      .where(
        and(eq(networthSnapshots.householdId, actor.householdId), eq(networthSnapshots.asOf, today), eq(networthSnapshots.source, 'manual'))
      )
      .limit(1)
    if (typedIn) return { taken: false, accountCount: 0, staleAccountCount: 0 }

    const linked = await tx
      .select({
        id: accounts.id,
        type: accounts.type,
        currentBalanceCents: accounts.currentBalanceCents,
        balanceUpdatedAt: accounts.balanceUpdatedAt,
        itemStatus: plaidItems.status,
        previousBalanceCents: sql<number | null>`(
          select ${accountSnapshots.balanceCents} from ${accountSnapshots}
          where ${accountSnapshots.accountId} = ${outerAccountId} and ${accountSnapshots.asOf} < ${today}
          order by ${accountSnapshots.asOf} desc limit 1
        )`.mapWith(Number),
      })
      .from(accounts)
      .innerJoin(plaidItems, eq(plaidItems.id, accounts.plaidItemId))
      .where(and(eq(accounts.householdId, actor.householdId), eq(accounts.isHidden, false)))

    const manual = await tx
      .select({ id: manualAccounts.id, kind: manualAccounts.kind, latestValueCents: manualValueOn(today) })
      .from(manualAccounts)
      .where(and(eq(manualAccounts.householdId, actor.householdId), isNull(manualAccounts.archivedAt)))

    const readings: PlannedAccountSnapshot[] = []
    const row = (planned: PlannedAccountSnapshot) => {
      readings.push(planned)
      return { householdId: actor.householdId, asOf: today, ...planned, createdAt: now, updatedAt: now }
    }
    const linkedRows = linked.flatMap(account => {
      const planned = planLinkedAccountSnapshot(account, now)
      return planned === null ? [] : [{ ...row(planned), accountId: account.id, source: 'plaid' as const }]
    })
    const manualRows = manual.flatMap(account => {
      const planned = planManualAccountSnapshot(account)
      return planned === null ? [] : [{ ...row(planned), manualAccountId: account.id, source: 'manual' as const }]
    })

    const set = { balanceCents: excluded('balance_cents'), isStale: excluded('is_stale'), updatedAt: excluded('updated_at') }
    const written: string[] = []
    if (linkedRows.length > 0) {
      const rows = await tx
        .insert(accountSnapshots)
        .values(linkedRows)
        .onConflictDoUpdate({ target: [accountSnapshots.accountId, accountSnapshots.asOf], set })
        .returning({ id: accountSnapshots.id })
      written.push(...rows.map(r => r.id))
    }
    if (manualRows.length > 0) {
      const rows = await tx
        .insert(accountSnapshots)
        .values(manualRows)
        .onConflictDoUpdate({ target: [accountSnapshots.manualAccountId, accountSnapshots.asOf], set })
        .returning({ id: accountSnapshots.id })
      written.push(...rows.map(r => r.id))
    }
    await tx
      .delete(accountSnapshots)
      .where(
        and(
          eq(accountSnapshots.householdId, actor.householdId),
          eq(accountSnapshots.asOf, today),
          written.length > 0 ? notInArray(accountSnapshots.id, written) : undefined
        )
      )

    const automaticToday = and(
      eq(networthSnapshots.householdId, actor.householdId),
      eq(networthSnapshots.asOf, today),
      eq(networthSnapshots.source, 'automatic')
    )
    if (readings.length === 0) {
      await tx.delete(networthSnapshots).where(automaticToday)
      return { taken: false, accountCount: 0, staleAccountCount: 0 }
    }

    const totals = summarizeReadings(readings)
    const saved = await tx
      .insert(networthSnapshots)
      .values({ householdId: actor.householdId, asOf: today, ...totals, source: 'automatic', createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [networthSnapshots.householdId, networthSnapshots.asOf],
        set: {
          assetsCents: excluded('assets_cents'),
          liabilitiesCents: excluded('liabilities_cents'),
          netCents: excluded('net_cents'),
          accountCount: excluded('account_count'),
          staleAccountCount: excluded('stale_account_count'),
          updatedAt: excluded('updated_at'),
        },
        setWhere: eq(networthSnapshots.source, 'automatic'),
      })
      .returning({ id: networthSnapshots.id })
    return { taken: saved.length > 0, accountCount: totals.accountCount, staleAccountCount: totals.staleAccountCount }
  })
}

// Outer columns inside a correlated subquery are spelled out with their table. Drizzle leaves the
// columns of a single-table select list unqualified, and Postgres would resolve a bare "id" to the
// subquery's own table.
const outerAccountId = sql`${accounts}.${sql.identifier('id')}`
const outerManualAccountId = sql`${manualAccounts}.${sql.identifier('id')}`

/** The manual account's newest value on or before a day, unsigned. Two on one day: the later entry. */
function manualValueOn(day: CalendarDate) {
  return sql<number | null>`(
    select ${manualValues.valueCents} from ${manualValues}
    where ${manualValues.manualAccountId} = ${outerManualAccountId} and ${manualValues.asOf} <= ${day}
    order by ${manualValues.asOf} desc, ${manualValues.createdAt} desc, ${manualValues.id} desc limit 1
  )`.mapWith(Number)
}

function manualValueDateOn(day: CalendarDate) {
  return sql<string | null>`(
    select ${manualValues.asOf}::text from ${manualValues}
    where ${manualValues.manualAccountId} = ${outerManualAccountId} and ${manualValues.asOf} <= ${day}
    order by ${manualValues.asOf} desc, ${manualValues.createdAt} desc, ${manualValues.id} desc limit 1
  )`
}

// ---------------------------------------------------------------------------------------------
// The series

const snapshotColumns = {
  asOf: networthSnapshots.asOf,
  source: networthSnapshots.source,
  assetsCents: networthSnapshots.assetsCents,
  liabilitiesCents: networthSnapshots.liabilitiesCents,
  netCents: networthSnapshots.netCents,
  accountCount: networthSnapshots.accountCount,
  staleAccountCount: networthSnapshots.staleAccountCount,
}

/** Every day recorded, measured or typed in, oldest first. A decade is under 4,000 small rows. */
export async function listNetWorthSnapshots(ctx: RequestContext, db: Db): Promise<NetWorthSnapshot[]> {
  requirePermission(ctx, 'finances.view')
  return db
    .select(snapshotColumns)
    .from(networthSnapshots)
    .where(eq(networthSnapshots.householdId, ctx.householdId))
    .orderBy(asc(networthSnapshots.asOf))
}

/** The first day the job measured. Null before it ever has. */
export async function getNetWorthTrackingStartedOn(ctx: RequestContext, db: Db): Promise<CalendarDate | null> {
  requirePermission(ctx, 'finances.view')
  const [row] = await db
    .select({ first: sql<string | null>`min(${networthSnapshots.asOf})::text` })
    .from(networthSnapshots)
    .where(and(eq(networthSnapshots.householdId, ctx.householdId), eq(networthSnapshots.source, 'automatic')))
  return row?.first ?? null
}

export interface NetWorthAccountSnapshotRow {
  id: string
  source: 'plaid' | 'manual'
  name: string
  /** Plaid's account type or the manual account's kind. */
  type: string
  /** Signed, as the snapshot stored it. */
  balanceCents: number
  isStale: boolean
  institutionName: string | null
  mask: string | null
  /** Connected accounts: when Plaid last refreshed the balance. */
  balanceUpdatedAt: Date | null
  /** Manual accounts: the date of the value the snapshot used. */
  valueOn: CalendarDate | null
}

/** The accounts a day's snapshot counted, with what it recorded for each. */
export async function listNetWorthAccountSnapshots(ctx: RequestContext, db: Db, asOf: CalendarDate): Promise<NetWorthAccountSnapshotRow[]> {
  requirePermission(ctx, 'finances.view')
  const day = and(eq(accountSnapshots.householdId, ctx.householdId), eq(accountSnapshots.asOf, asOf))
  const [linked, manual] = await Promise.all([
    db
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.type,
        balanceCents: accountSnapshots.balanceCents,
        isStale: accountSnapshots.isStale,
        institutionName: plaidItems.institutionName,
        mask: accounts.mask,
        balanceUpdatedAt: accounts.balanceUpdatedAt,
      })
      .from(accountSnapshots)
      .innerJoin(accounts, eq(accounts.id, accountSnapshots.accountId))
      .innerJoin(plaidItems, eq(plaidItems.id, accounts.plaidItemId))
      .where(day),
    db
      .select({
        id: manualAccounts.id,
        name: manualAccounts.name,
        type: manualAccounts.kind,
        balanceCents: accountSnapshots.balanceCents,
        isStale: accountSnapshots.isStale,
        valueOn: manualValueDateOn(asOf),
      })
      .from(accountSnapshots)
      .innerJoin(manualAccounts, eq(manualAccounts.id, accountSnapshots.manualAccountId))
      .where(day),
  ])
  return [
    ...linked.map(row => ({ ...row, source: 'plaid' as const, valueOn: null })),
    ...manual.map(row => ({ ...row, source: 'manual' as const, institutionName: null, mask: null, balanceUpdatedAt: null })),
  ]
}

// ---------------------------------------------------------------------------------------------
// Investments

export interface InvestmentAccountRow {
  id: string
  name: string
  type: string
  institutionName: string | null
  mask: string | null
  /** As Plaid reports it, unsigned. */
  currentBalanceCents: number | null
}

/** Visible investment accounts, and any other account holding positions. */
export async function listInvestmentAccounts(ctx: RequestContext, db: Db): Promise<InvestmentAccountRow[]> {
  requirePermission(ctx, 'finances.view')
  return db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      institutionName: plaidItems.institutionName,
      mask: accounts.mask,
      currentBalanceCents: accounts.currentBalanceCents,
    })
    .from(accounts)
    .innerJoin(plaidItems, eq(plaidItems.id, accounts.plaidItemId))
    .where(
      and(
        eq(accounts.householdId, ctx.householdId),
        eq(accounts.isHidden, false),
        or(
          inArray(accounts.type, INVESTMENT_ACCOUNT_TYPES),
          sql`exists (select 1 from ${holdings} where ${holdings.accountId} = ${accounts.id})`
        )
      )
    )
    .orderBy(asc(sql`lower(${accounts.name})`), asc(accounts.id))
}

export type HoldingRow = Pick<
  typeof holdings.$inferSelect,
  'accountId' | 'plaidSecurityId' | 'ticker' | 'name' | 'securityType' | 'quantity' | 'costBasisCents' | 'valueCents' | 'asOf'
>

/** Positions in visible accounts. Composition only: never add these into a balance. */
export async function listHoldings(ctx: RequestContext, db: Db): Promise<HoldingRow[]> {
  requirePermission(ctx, 'finances.view')
  return db
    .select({
      accountId: holdings.accountId,
      plaidSecurityId: holdings.plaidSecurityId,
      ticker: holdings.ticker,
      name: holdings.name,
      securityType: holdings.securityType,
      quantity: holdings.quantity,
      costBasisCents: holdings.costBasisCents,
      valueCents: holdings.valueCents,
      asOf: holdings.asOf,
    })
    .from(holdings)
    .innerJoin(accounts, eq(accounts.id, holdings.accountId))
    .where(and(eq(holdings.householdId, ctx.householdId), eq(accounts.isHidden, false)))
}

/** Connected accounts' readings since a day, oldest first. */
export async function listAccountSnapshotSeries(
  ctx: RequestContext,
  db: Db,
  input: { accountIds: readonly string[]; from: CalendarDate }
): Promise<{ accountId: string; asOf: CalendarDate; balanceCents: number; isStale: boolean }[]> {
  requirePermission(ctx, 'finances.view')
  if (input.accountIds.length === 0) return []
  const rows = await db
    .select({
      accountId: accountSnapshots.accountId,
      asOf: accountSnapshots.asOf,
      balanceCents: accountSnapshots.balanceCents,
      isStale: accountSnapshots.isStale,
    })
    .from(accountSnapshots)
    .where(
      and(
        eq(accountSnapshots.householdId, ctx.householdId),
        inArray(accountSnapshots.accountId, [...input.accountIds]),
        gte(accountSnapshots.asOf, input.from)
      )
    )
    .orderBy(asc(accountSnapshots.asOf))
  return rows.flatMap(({ accountId, ...row }) => (accountId === null ? [] : [{ accountId, ...row }]))
}

/**
 * Posted transfers on the accounts since a day, signed from the account's side: positive is money
 * moved in. Only what the household's own transactions flagged as a transfer.
 */
export async function listAccountTransfers(
  ctx: RequestContext,
  db: Db,
  input: { accountIds: readonly string[]; from: CalendarDate }
): Promise<{ accountId: string; date: CalendarDate; amountCents: number }[]> {
  requirePermission(ctx, 'finances.view')
  if (input.accountIds.length === 0) return []
  const rows = await db
    .select({ accountId: transactions.accountId, date: transactions.date, amountCents: transactions.amountCents })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, ctx.householdId),
        inArray(transactions.accountId, [...input.accountIds]),
        eq(transactions.isTransfer, true),
        eq(transactions.isPending, false),
        eq(transactions.isExcluded, false),
        gte(transactions.date, input.from)
      )
    )
    .orderBy(asc(transactions.date))
  return rows.flatMap(({ accountId, ...row }) => (accountId === null ? [] : [{ accountId, ...row }]))
}

// ---------------------------------------------------------------------------------------------
// Debts

export interface LinkedDebtRow {
  id: string
  name: string
  type: string
  subtype: string | null
  institutionName: string | null
  mask: string | null
  /** As Plaid reports it: what is owed, unsigned. */
  currentBalanceCents: number | null
  /** Null when /liabilities/get hasn't described the account. */
  kind: LiabilityKind | null
  aprPercent: number | null
  minimumPaymentCents: number | null
  nextPaymentDueOn: CalendarDate | null
  isOverdue: boolean
  lastPaymentCents: number | null
  lastPaymentOn: CalendarDate | null
  originationDate: CalendarDate | null
  originalPrincipalCents: number | null
}

/** The account types BALANCE_SIGN counts as owed. */
const OWED_TYPES = Object.entries(BALANCE_SIGN).flatMap(([type, sign]) => (sign === -1 ? [type] : []))

/** Visible connected accounts that are owed: credit and loan types, and any with liability detail. */
export async function listLinkedDebts(ctx: RequestContext, db: Db): Promise<LinkedDebtRow[]> {
  requirePermission(ctx, 'finances.view')
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      subtype: accounts.subtype,
      institutionName: plaidItems.institutionName,
      mask: accounts.mask,
      currentBalanceCents: accounts.currentBalanceCents,
      kind: liabilityDetails.kind,
      aprPercent: liabilityDetails.aprPercent,
      minimumPaymentCents: liabilityDetails.minimumPaymentCents,
      nextPaymentDueOn: liabilityDetails.nextPaymentDueOn,
      isOverdue: liabilityDetails.isOverdue,
      lastPaymentCents: liabilityDetails.lastPaymentCents,
      lastPaymentOn: liabilityDetails.lastPaymentOn,
      originationDate: liabilityDetails.originationDate,
      originalPrincipalCents: liabilityDetails.originalPrincipalCents,
    })
    .from(accounts)
    .innerJoin(plaidItems, eq(plaidItems.id, accounts.plaidItemId))
    .leftJoin(liabilityDetails, eq(liabilityDetails.accountId, accounts.id))
    .where(
      and(
        eq(accounts.householdId, ctx.householdId),
        eq(accounts.isHidden, false),
        or(inArray(accounts.type, OWED_TYPES), sql`${liabilityDetails.id} is not null`)
      )
    )
  return rows.map(row => ({ ...row, isOverdue: row.isOverdue ?? false }))
}

export interface LiabilityDueRow {
  accountId: string
  name: string
  institutionName: string | null
  mask: string | null
  kind: LiabilityKind
  nextPaymentDueOn: CalendarDate
  minimumPaymentCents: number | null
  lastPaymentCents: number | null
  lastPaymentOn: CalendarDate | null
  isOverdue: boolean
  isoCurrency: string | null
}

/** Payments due on visible connected debts between two days, soonest first. For bills and the calendar. */
export async function listLiabilityDues(
  ctx: RequestContext,
  db: Db,
  input: { from: CalendarDate; to: CalendarDate }
): Promise<LiabilityDueRow[]> {
  requirePermission(ctx, 'finances.view')
  const rows = await db
    .select({
      accountId: liabilityDetails.accountId,
      name: accounts.name,
      institutionName: plaidItems.institutionName,
      mask: accounts.mask,
      kind: liabilityDetails.kind,
      nextPaymentDueOn: liabilityDetails.nextPaymentDueOn,
      minimumPaymentCents: liabilityDetails.minimumPaymentCents,
      lastPaymentCents: liabilityDetails.lastPaymentCents,
      lastPaymentOn: liabilityDetails.lastPaymentOn,
      isOverdue: liabilityDetails.isOverdue,
      isoCurrency: accounts.isoCurrency,
    })
    .from(liabilityDetails)
    .innerJoin(accounts, eq(accounts.id, liabilityDetails.accountId))
    .innerJoin(plaidItems, eq(plaidItems.id, accounts.plaidItemId))
    .where(
      and(
        eq(liabilityDetails.householdId, ctx.householdId),
        eq(accounts.isHidden, false),
        gte(liabilityDetails.nextPaymentDueOn, input.from),
        lte(liabilityDetails.nextPaymentDueOn, input.to)
      )
    )
    .orderBy(asc(liabilityDetails.nextPaymentDueOn), asc(accounts.name))
  return rows.flatMap(({ nextPaymentDueOn, ...row }) => (nextPaymentDueOn === null ? [] : [{ ...row, nextPaymentDueOn }]))
}

// ---------------------------------------------------------------------------------------------
// History typed in from old records

export type NetWorthHistoryRow = typeof networthSnapshots.$inferSelect

const ENTRY_NOT_FOUND = 'That entry no longer exists.'

const historyOrder: Keyset = { keys: [{ expr: networthSnapshots.asOf, kind: 'date', desc: true }], id: networthSnapshots.id, idDesc: true }

function manualHistory(ctx: RequestContext): SQL | undefined {
  return and(eq(networthSnapshots.householdId, ctx.householdId), eq(networthSnapshots.source, 'manual'))
}

/** Typed-in days only, newest first. */
export async function listNetWorthHistoryPage(ctx: RequestContext, db: Db, page: PageRequest): Promise<Page<NetWorthHistoryRow>> {
  requirePermission(ctx, 'finances.view')
  const rows = await db
    .select({ ...getTableColumns(networthSnapshots), pageKeys: pageKeys(historyOrder) })
    .from(networthSnapshots)
    .where(and(manualHistory(ctx), keysetAfter(historyOrder, page.after)))
    .orderBy(...keysetOrder(historyOrder))
    .limit(page.limit + 1)
  return toPage(rows, page.limit)
}

/**
 * Sets a typed-in day, replacing one already typed in for it. Validation, including that the day is
 * before tracking began, happens in @ghar/core/finances first. A measured day is never replaced.
 */
export async function saveNetWorthHistory(
  ctx: RequestContext,
  db: Db,
  input: { asOf: CalendarDate; assetsCents: number; liabilitiesCents: number; netCents: number }
): Promise<NetWorthHistoryRow> {
  requirePermission(ctx, 'finances.manage')
  const [row] = await db
    .insert(networthSnapshots)
    .values({ householdId: ctx.householdId, ...input, accountCount: 0, staleAccountCount: 0, source: 'manual' })
    .onConflictDoUpdate({
      target: [networthSnapshots.householdId, networthSnapshots.asOf],
      set: {
        assetsCents: excluded('assets_cents'),
        liabilitiesCents: excluded('liabilities_cents'),
        netCents: excluded('net_cents'),
        updatedAt: sql`now()`,
      },
      setWhere: eq(networthSnapshots.source, 'manual'),
    })
    .returning()
  if (!row) throw new ConflictError('Ghar already measured that day. Enter a date before tracking started.')
  return row
}

export async function deleteNetWorthHistory(ctx: RequestContext, db: Db, entryId: string): Promise<void> {
  requirePermission(ctx, 'finances.manage')
  await db.transaction(async tx => {
    const [deleted] = await tx
      .delete(networthSnapshots)
      .where(and(eq(networthSnapshots.id, entryId), manualHistory(ctx)))
      .returning({ asOf: networthSnapshots.asOf })
    if (!deleted) throw new NotFoundError(ENTRY_NOT_FOUND)
    await recordAudit(ctx, tx, {
      action: 'networth_history.deleted',
      entity: 'networth_snapshot',
      entityId: entryId,
      metadata: { asOf: deleted.asOf },
    })
  })
}

// ---------------------------------------------------------------------------------------------
// Across households

/** Households with anything to snapshot, for the daily job. */
export async function listHouseholdsForNetWorth(db: Db): Promise<{ id: string; timezone: string }[]> {
  return db
    .select({ id: households.id, timezone: households.timezone })
    .from(households)
    .where(
      or(
        sql`exists (select 1 from ${accounts} where ${accounts.householdId} = ${households.id})`,
        sql`exists (select 1 from ${manualAccounts} where ${manualAccounts.householdId} = ${households.id} and ${manualAccounts.archivedAt} is null)`,
        // A household whose last account went away still gets today's row cleared.
        sql`exists (select 1 from ${accountSnapshots} where ${accountSnapshots.householdId} = ${households.id})`
      )
    )
}
