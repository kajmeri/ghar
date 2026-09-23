import 'server-only'
import type {
  CreateManualAccountBody,
  Debt,
  ManualAccount,
  ManualValue,
  ManualValueBody,
  NetWorthAccountValue,
  NetWorthComposition,
  NetWorthHistoryBody,
  NetWorthHistoryEntry,
  NetWorthRangeValue,
  NetWorthResponse,
  PageQuery,
  UpdateManualAccountBody,
} from '@ghar/contracts'
import { addCalendarMonths, toCalendarDate, todayInTimeZone, type CalendarDate } from '@ghar/core/dates'
import {
  allocation,
  balanceTypeLabel,
  computeDeltas,
  groupNetWorthAccounts,
  netWorthChart,
  signedBalanceCents,
  sortDebts,
  splitContributionFromMarket,
  validateHistoricalSnapshot,
  validateManualAccount,
  validateManualValue,
  type NetWorthAccountGroup,
} from '@ghar/core/finances'
import * as queries from '@ghar/db/queries'
import type { Session } from '@/lib/api/authed'
import { pageRequest, pageResponse, type PageResult } from '@/lib/api/cursor'
import { getDb } from '@/lib/db'
import { getMonitoring } from '@/lib/providers/monitoring'
import { toManualAccount, toManualValue, toNetWorthHistoryEntry } from './serialize'

// Net worth as /api/v1/net-worth and /api/v1/manual-accounts serve it and the page reads it. Every
// figure comes from stored snapshots that already carry their sign; the shaping is @ghar/core/finances.
// Reads need finances.view and changes finances.manage, both checked in @ghar/db/queries, so a member
// gets a 403 from all of it.

const householdToday = (session: Session, now = new Date()) => todayInTimeZone(session.household.timeZone, now)

/**
 * Takes today's snapshot again after a manual account changes, so the number moves when the house
 * estimate does rather than tomorrow. The daily job rewrites the same row anyway, so a failure here is
 * reported and the change still stands.
 */
async function refreshTodaysSnapshot(session: Session): Promise<void> {
  const now = new Date()
  try {
    await queries.takeNetWorthSnapshot(session.context, getDb(), { today: householdToday(session, now), now })
  } catch (error) {
    getMonitoring().captureException(error, { level: 'warning', tags: { step: 'networth.snapshot_refresh' } })
  }
}

// ---------------------------------------------------------------------------------------------
// The overview

export async function getNetWorth(session: Session, range: NetWorthRangeValue): Promise<NetWorthResponse> {
  const db = getDb()
  const snapshots = await queries.listNetWorthSnapshots(session.context, db)
  const latest = snapshots.at(-1) ?? null
  const rows = latest === null ? [] : await queries.listNetWorthAccountSnapshots(session.context, db, latest.asOf)
  const { assets, liabilities } = groupNetWorthAccounts(
    rows.map(row => ({
      id: row.id,
      name: row.name,
      source: row.source,
      type: row.type,
      balanceCents: row.balanceCents,
      isStale: row.isStale,
      updatedOn: row.valueOn ?? (row.balanceUpdatedAt === null ? null : toCalendarDate(row.balanceUpdatedAt, session.household.timeZone)),
      institutionName: row.institutionName,
      mask: row.mask,
    }))
  )

  return {
    latest:
      latest === null
        ? null
        : {
            asOf: latest.asOf,
            assetsCents: latest.assetsCents,
            liabilitiesCents: latest.liabilitiesCents,
            netCents: latest.netCents,
            accountCount: latest.accountCount,
            staleAccountCount: latest.staleAccountCount,
          },
    deltas: computeDeltas(snapshots),
    chart: netWorthChart(snapshots, { range, today: householdToday(session) }),
    assets: withTypeLabels(assets),
    liabilities: withTypeLabels(liabilities),
  }
}

function withTypeLabels(group: NetWorthAccountGroup): { totalCents: number; accounts: NetWorthAccountValue[] } {
  return { totalCents: group.totalCents, accounts: group.accounts.map(account => ({ ...account, typeLabel: balanceTypeLabel(account.type) })) }
}

// ---------------------------------------------------------------------------------------------
// Investments

/**
 * What the holdings are in, and each investment account's value beside what its holdings add up to.
 * The account's value is its balance, as in net worth; holdings are composition only.
 */
export async function getNetWorthComposition(session: Session): Promise<NetWorthComposition> {
  const { context } = session
  const db = getDb()
  const [accounts, holdings] = await Promise.all([queries.listInvestmentAccounts(context, db), queries.listHoldings(context, db)])
  const range = { accountIds: accounts.map(account => account.id), from: addCalendarMonths(householdToday(session), -12) }
  const [series, transfers] = await Promise.all([
    queries.listAccountSnapshotSeries(context, db, range),
    queries.listAccountTransfers(context, db, range),
  ])

  return {
    ...allocation(holdings),
    accounts: accounts.map(account => {
      const positions = holdings.filter(holding => holding.accountId === account.id)
      return {
        accountId: account.id,
        name: account.name,
        institutionName: account.institutionName,
        mask: account.mask,
        balanceCents: account.currentBalanceCents === null ? null : signedBalanceCents(account.type, account.currentBalanceCents),
        holdingsValueCents: positions.reduce((sum, holding) => sum + holding.valueCents, 0),
        holdingsAsOf: positions.reduce<CalendarDate | null>((newest, holding) => (newest === null || holding.asOf > newest ? holding.asOf : newest), null),
        change: yearChange(
          series.filter(reading => reading.accountId === account.id),
          transfers.filter(transfer => transfer.accountId === account.id)
        ),
      }
    }),
  }
}

function yearChange(
  readings: readonly { asOf: CalendarDate; balanceCents: number; isStale: boolean }[],
  transfers: readonly { date: CalendarDate; amountCents: number }[]
): NetWorthComposition['accounts'][number]['change'] {
  const first = readings[0]
  const last = readings.at(-1)
  if (first === undefined || last === undefined || first.asOf === last.asOf) return null
  const { totals } = splitContributionFromMarket(readings, transfers)
  return { fromOn: first.asOf, toOn: last.asOf, ...totals }
}

// ---------------------------------------------------------------------------------------------
// Debts

/** Connected cards and loans with what Plaid said about them, and manual loans, highest APR first. */
export async function listDebts(session: Session): Promise<{ debts: Debt[] }> {
  const db = getDb()
  const [linked, manual] = await Promise.all([
    queries.listLinkedDebts(session.context, db),
    queries.listManualAccounts(session.context, db, { includeArchived: false }),
  ])

  const debts: Debt[] = [
    ...linked.map(
      (row): Debt => ({
        id: row.id,
        source: 'plaid',
        name: row.name,
        institutionName: row.institutionName,
        mask: row.mask,
        kind: row.kind ?? 'other',
        balanceCents: signedBalanceCents(row.type, row.currentBalanceCents ?? 0),
        aprPercent: row.aprPercent,
        minimumPaymentCents: row.minimumPaymentCents,
        nextPaymentDueOn: row.nextPaymentDueOn,
        isOverdue: row.isOverdue,
        lastPaymentCents: row.lastPaymentCents,
        lastPaymentOn: row.lastPaymentOn,
        originationDate: row.originationDate,
        originalPrincipalCents: row.originalPrincipalCents,
      })
    ),
    // A manual loan with no value yet isn't in net worth either.
    ...manual.flatMap((account): Debt[] =>
      account.isLiability && account.latestValueCents !== null
        ? [
            {
              id: account.id,
              source: 'manual',
              name: account.name,
              institutionName: null,
              mask: null,
              kind: 'other',
              balanceCents: signedBalanceCents(account.kind, account.latestValueCents),
              aprPercent: null,
              minimumPaymentCents: null,
              nextPaymentDueOn: null,
              isOverdue: false,
              lastPaymentCents: null,
              lastPaymentOn: null,
              originationDate: null,
              originalPrincipalCents: null,
            },
          ]
        : []
    ),
  ]
  return { debts: sortDebts(debts) }
}

// ---------------------------------------------------------------------------------------------
// Manual accounts

export async function listManualAccountsPage(session: Session, query: PageQuery & { includeArchived: boolean }): Promise<PageResult<ManualAccount>> {
  const scope = { sort: 'manual-accounts:name', filters: { includeArchived: query.includeArchived } }
  const page = await queries.listManualAccountsPage(session.context, getDb(), pageRequest(query, scope), { includeArchived: query.includeArchived })
  return pageResponse(page, scope, toManualAccount)
}

export async function getManualAccount(session: Session, manualAccountId: string): Promise<ManualAccount> {
  return toManualAccount(await queries.getManualAccount(session.context, getDb(), manualAccountId))
}

export async function createManualAccount(session: Session, body: CreateManualAccountBody): Promise<ManualAccount> {
  const account = validateManualAccount(body)
  const value = body.value === null ? null : validateManualValue(body.value, householdToday(session))
  const row = await queries.createManualAccount(session.context, getDb(), account, value)
  await refreshTodaysSnapshot(session)
  return toManualAccount(row)
}

export async function updateManualAccount(session: Session, manualAccountId: string, body: UpdateManualAccountBody): Promise<ManualAccount> {
  const row = await queries.updateManualAccount(session.context, getDb(), manualAccountId, { ...validateManualAccount(body), archived: body.archived })
  await refreshTodaysSnapshot(session)
  return toManualAccount(row)
}

export async function deleteManualAccount(session: Session, manualAccountId: string): Promise<{ manualAccountId: string }> {
  await queries.deleteManualAccount(session.context, getDb(), manualAccountId)
  await refreshTodaysSnapshot(session)
  return { manualAccountId }
}

export async function listManualValuesPage(session: Session, manualAccountId: string, query: PageQuery): Promise<PageResult<ManualValue>> {
  const scope = { sort: 'manual-values:as-of-desc', filters: { manualAccountId } }
  const page = await queries.listManualValuesPage(session.context, getDb(), manualAccountId, pageRequest(query, scope))
  return pageResponse(page, scope, toManualValue)
}

/** A new value beside the old ones, never over them. */
export async function addManualValue(session: Session, manualAccountId: string, body: ManualValueBody): Promise<{ value: ManualValue; account: ManualAccount }> {
  const fields = validateManualValue(body, householdToday(session))
  const { value, account } = await queries.addManualValue(session.context, getDb(), manualAccountId, fields)
  await refreshTodaysSnapshot(session)
  return { value: toManualValue(value), account: toManualAccount(account) }
}

export async function deleteManualValue(session: Session, manualAccountId: string, valueId: string): Promise<{ valueId: string; account: ManualAccount }> {
  const account = await queries.deleteManualValue(session.context, getDb(), manualAccountId, valueId)
  await refreshTodaysSnapshot(session)
  return { valueId, account: toManualAccount(account) }
}

// ---------------------------------------------------------------------------------------------
// History typed in from old records

export async function listNetWorthHistoryPage(session: Session, query: PageQuery): Promise<PageResult<NetWorthHistoryEntry>> {
  const scope = { sort: 'networth-history:as-of-desc' }
  const page = await queries.listNetWorthHistoryPage(session.context, getDb(), pageRequest(query, scope))
  return pageResponse(page, scope, toNetWorthHistoryEntry)
}

/** Only for days before tracking began: Plaid can't be asked for them, and a measured day stays measured. */
export async function saveNetWorthHistory(session: Session, body: NetWorthHistoryBody): Promise<NetWorthHistoryEntry> {
  const db = getDb()
  const trackingStartedOn = await queries.getNetWorthTrackingStartedOn(session.context, db)
  const fields = validateHistoricalSnapshot(body, { today: householdToday(session), trackingStartedOn })
  return toNetWorthHistoryEntry(await queries.saveNetWorthHistory(session.context, db, fields))
}

export async function deleteNetWorthHistory(session: Session, entryId: string): Promise<{ entryId: string }> {
  await queries.deleteNetWorthHistory(session.context, getDb(), entryId)
  return { entryId }
}
