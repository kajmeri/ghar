import 'server-only'
import type { HomeMoney, MoneyOverview } from '@ghar/contracts'
import { addCalendarDays, todayInTimeZone } from '@ghar/core/dates'
import {
  addMonths,
  cashAndCards,
  compareSpend,
  monthPace,
  monthStart,
  monthToDateWindows,
  netWorthGlance,
  summarizeSpend,
  topCategorySpend,
  type InsightCategory,
} from '@ghar/core/finances'
import * as queries from '@ghar/db/queries'
import type { Session } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { toTransaction } from '@/lib/finances/transactions'

// The Money screen's one answer: the month so far, day by day and where it went, net worth at a
// glance, and what is waiting. Everything
// it says is worked out in @ghar/core from rows the database added up; this file only asks.

/** How many categories the overview names before it stops. The rest are one line on the list. */
const TOP_CATEGORIES = 5
/** The newest charges the overview carries, so the screen isn't a page of links. */
const RECENT_CHARGES = 5

export async function loadMoneyOverview(session: Session): Promise<MoneyOverview> {
  const { context } = session
  const db = getDb()
  const today = todayInTimeZone(session.household.timeZone)
  const periodStart = monthStart(today)
  const { current, previous } = monthToDateWindows(today)

  const [thisMonth, lastMonth, categoryRows, accounts, period, reviewCount, recent, daily, snapshots] = await Promise.all([
    queries.listCategorySpend(context, db, current),
    queries.listCategorySpend(context, db, previous),
    queries.listCategories(context, db),
    queries.listAccounts(context, db),
    queries.getBudgetPeriod(context, db, { periodStart, today }),
    queries.countReviewQueue(context, db),
    queries.listTransactions(context, db, {}, { limit: RECENT_CHARGES }),
    queries.listDailyCategorySpend(context, db, { from: addMonths(periodStart, -1), to: addCalendarDays(today, 1) }),
    queries.listNetWorthSnapshots(context, db),
  ])

  const categories: InsightCategory[] = categoryRows.map(row => ({ id: row.id, parentId: row.parentId, kind: row.kind }))
  const names = new Map(categoryRows.map(row => [row.id, row.name]))
  const spend = summarizeSpend(thisMonth, categories)
  const previousSpend = summarizeSpend(lastMonth, categories)
  const { total } = period.summary

  return {
    today,
    monthStart: periodStart,
    spentCents: spend.spentCents,
    incomeCents: spend.incomeCents,
    previousSpentCents: previousSpend.spentCents,
    ...compareSpend(spend.spentCents, previousSpend.spentCents),
    categories: topCategorySpend(thisMonth, categories, { limit: TOP_CATEGORIES }).map(row => ({
      ...row,
      name: row.categoryId === null ? 'Not filed yet' : (names.get(row.categoryId) ?? 'Not filed yet'),
    })),
    // A month nobody has planned has no budget to report, however much it has spent.
    budget:
      period.lines.length === 0
        ? null
        : {
            periodStart: period.periodStart,
            availableCents: total.availableCents,
            spentCents: total.spentCents,
            remainingCents: total.remainingCents,
            pace: total.pace,
            elapsedShare: period.summary.elapsedShare,
          },
    pace: monthPace({ rows: daily, categories, today, budgetCents: period.lines.length === 0 ? null : total.availableCents }),
    netWorth: netWorthGlance(snapshots),
    ...cashAndCards(accounts),
    reviewCount,
    recent: recent.rows.map(toTransaction),
  }
}

/**
 * The month's money for the card on Home: the Money screen's own figures, fewer of them. Null when
 * there's nothing to show yet, so a household that hasn't connected a bank isn't shown zeros.
 */
export async function loadHomeMoney(session: Session): Promise<HomeMoney | null> {
  const { context } = session
  const db = getDb()
  const today = todayInTimeZone(session.household.timeZone)
  const periodStart = monthStart(today)
  const { current, previous } = monthToDateWindows(today)

  const [thisMonth, lastMonth, categoryRows, period, snapshots] = await Promise.all([
    queries.listCategorySpend(context, db, current),
    queries.listCategorySpend(context, db, previous),
    queries.listCategories(context, db),
    queries.getBudgetPeriod(context, db, { periodStart, today }),
    queries.listNetWorthSnapshots(context, db),
  ])
  if (thisMonth.length === 0 && lastMonth.length === 0 && snapshots.length === 0) return null

  const categories: InsightCategory[] = categoryRows.map(row => ({ id: row.id, parentId: row.parentId, kind: row.kind }))
  const { total } = period.summary
  const glance = netWorthGlance(snapshots)
  return {
    monthStart: periodStart,
    spentCents: summarizeSpend(thisMonth, categories).spentCents,
    previousSpentCents: summarizeSpend(lastMonth, categories).spentCents,
    budget:
      period.lines.length === 0
        ? null
        : { availableCents: total.availableCents, spentCents: total.spentCents, elapsedShare: period.summary.elapsedShare },
    netWorth: glance === null ? null : { netCents: glance.netCents, monthChangeCents: glance.month?.cents ?? null },
  }
}
