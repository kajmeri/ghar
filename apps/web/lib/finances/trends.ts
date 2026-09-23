import 'server-only'
import type { SpendingTrendsValue, TrendRangeValue } from '@ghar/contracts'
import { addCalendarDays, todayInTimeZone } from '@ghar/core/dates'
import { recentMonths, spendingTrends, type InsightCategory } from '@ghar/core/finances'
import * as queries from '@ghar/db/queries'
import type { Session } from '@/lib/api/authed'
import { getDb } from '@/lib/db'

// Spending over time. @ghar/core works out every figure and every bar's scale from the monthly
// rows the database added up; this file asks for them and puts names on the categories.

/** How many merchants the screen names. */
const TOP_MERCHANTS = 8

const UNFILED = { name: 'Not filed yet', icon: 'tag', colorToken: 'ink-muted' } as const

export async function loadSpendingTrends(session: Session, range: TrendRangeValue): Promise<SpendingTrendsValue> {
  const { context } = session
  const db = getDb()
  const today = todayInTimeZone(session.household.timeZone)
  const window = { from: recentMonths(today, range === '12M' ? 12 : 6)[0] ?? today, to: addCalendarDays(today, 1) }

  const [rows, categoryRows] = await Promise.all([
    queries.listMonthlyCategorySpend(context, db, window),
    queries.listCategories(context, db),
  ])
  const categories: InsightCategory[] = categoryRows.map(row => ({ id: row.id, parentId: row.parentId, kind: row.kind }))
  const byId = new Map(categoryRows.map(row => [row.id, row]))
  const trends = spendingTrends({ rows, categories, today, range })

  // Months before the first charge are left off, so the merchants cover the same months the chart does.
  const firstMonth = trends.months[0] ?? window.from
  const merchants = await queries.listTopMerchants(context, db, { from: firstMonth, to: window.to, limit: TOP_MERCHANTS })
  const spentCents = trends.monthly.reduce((sum, month) => sum + month.spentCents, 0)

  return {
    ...trends,
    today,
    categories: trends.categories.map(category => {
      const row = category.categoryId === null ? undefined : byId.get(category.categoryId)
      return {
        ...category,
        name: row?.name ?? UNFILED.name,
        icon: row?.icon ?? UNFILED.icon,
        colorToken: row?.colorToken ?? UNFILED.colorToken,
      }
    }),
    merchants: merchants.map(merchant => ({
      ...merchant,
      share: spentCents > 0 ? Math.min(Math.max(merchant.spentCents / spentCents, 0), 1) : 0,
    })),
    changes: trends.changes.map(change => ({ ...change, name: byId.get(change.categoryId)?.name ?? UNFILED.name })),
  }
}
