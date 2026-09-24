import {
  CATEGORY_COLOR_TOKENS,
  CATEGORY_ICONS,
  CATEGORY_MATCHER_TYPES,
  CATEGORY_NAME_MAX_LENGTH,
  CATEGORY_SOURCES,
  BUDGET_HISTORY_MONTHS,
  budgetHistory,
  goalHistory,
  MATCHER_VALUE_MAX_LENGTH,
  monthPace,
  netWorthGlance,
  spendingTrends,
  TREND_RANGES,
} from '@ghar/core/finances'
import { describe, expect, it } from 'vitest'
import {
  budgetHistorySchema,
  categoryColorTokenSchema,
  categoryIconSchema,
  categoryMatcherTypeSchema,
  categorySourceSchema,
  createCategory,
  getSpendingTrends,
  goalHistorySchema,
  monthPaceSchema,
  netWorthGlanceSchema,
  saveCategoryRule,
  trendRangeSchema,
} from '../src/v1/finances'

describe('finances contracts', () => {
  it('mirrors the lists in core', () => {
    expect(categoryIconSchema.options).toEqual([...CATEGORY_ICONS])
    expect(categoryColorTokenSchema.options).toEqual([...CATEGORY_COLOR_TOKENS])
    expect(categoryMatcherTypeSchema.options).toEqual([...CATEGORY_MATCHER_TYPES])
    expect(categorySourceSchema.options).toEqual([...CATEGORY_SOURCES])
    expect(trendRangeSchema.options).toEqual([...TREND_RANGES])
  })

  it('carries what core works out for spending over time, once names are on it', () => {
    const categoryId = '3f6f1f4e-1b2a-4c3d-8e9f-0a1b2c3d4e5f'
    const trends = spendingTrends({
      rows: [
        { month: '2026-08-01', categoryId, spentCents: 40_000 },
        { month: '2026-09-01', categoryId, spentCents: 10_000 },
      ],
      categories: [{ id: categoryId, parentId: null, kind: 'expense' }],
      today: '2026-09-23',
      range: '6M',
    })
    const named = {
      ...trends,
      today: '2026-09-23',
      categories: trends.categories.map(category => ({ ...category, name: 'Food', icon: 'utensils', colorToken: 'ink-muted' })),
      merchants: [],
      changes: trends.changes.map(change => ({ ...change, name: 'Food' })),
    }
    expect(getSpendingTrends.response.parse(named)).toEqual(named)
    expect(getSpendingTrends.query?.parse({})).toEqual({ range: '6M' })
  })

  it('carries the month day by day, and net worth at a glance, as core works them out', () => {
    const pace = monthPace({
      rows: [
        { date: '2026-08-31', categoryId: null, spentCents: 1_000 },
        { date: '2026-09-02', categoryId: null, spentCents: 2_000 },
      ],
      categories: [],
      today: '2026-09-23',
      budgetCents: 50_000,
    })
    expect(monthPaceSchema.parse(pace)).toEqual(pace)

    // A full three months of daily readings still fits.
    const snapshots = Array.from({ length: 120 }, (_, index) => ({
      asOf: new Date(Date.UTC(2026, 5, 1 + index)).toISOString().slice(0, 10),
      netCents: 100_000 + index,
      assetsCents: 100_000 + index,
      liabilitiesCents: 0,
      accountCount: 1,
      staleAccountCount: 0,
      source: 'automatic' as const,
    }))
    const glance = netWorthGlance(snapshots)
    expect(netWorthGlanceSchema.parse(glance)).toEqual(glance)
  })

  it('carries months against their plans, and a goal building up, as core works them out', () => {
    const history = budgetHistory(
      Array.from({ length: BUDGET_HISTORY_MONTHS }, (_, index) => ({
        periodStart: `2026-0${4 + index}-01`,
        planned: true,
        availableCents: 100_000,
        spentCents: 90_000 + index * 5_000,
        closed: index < BUDGET_HISTORY_MONTHS - 1,
      })),
      { currentPeriodStart: '2026-09-01' }
    )
    expect(budgetHistorySchema.parse(history)).toEqual(history)

    // Six months of daily readings still fits as weeks.
    const readings = Array.from({ length: 200 }, (_, index) => ({
      asOf: new Date(Date.UTC(2026, 2, 1 + index)).toISOString().slice(0, 10),
      balanceCents: index * 100,
    }))
    const goal = {
      goalId: '3f6f1f4e-1b2a-4c3d-8e9f-0a1b2c3d4e5f',
      ...goalHistory({ targetCents: 50_000, savedCents: 20_000, readings, today: '2026-09-23' }),
    }
    expect(goalHistorySchema.parse(goal)).toEqual(goal)
  })

  it('holds a category name and a matcher to the same lengths core does', () => {
    const name = 'x'.repeat(CATEGORY_NAME_MAX_LENGTH)
    const category = { name, kind: 'expense', icon: 'tag' }
    expect(createCategory.body?.safeParse(category).success).toBe(true)
    expect(createCategory.body?.safeParse({ ...category, name: `${name}x` }).success).toBe(false)

    const rule = { matcherType: 'merchant_contains', categoryId: '3f6f1f4e-1b2a-4c3d-8e9f-0a1b2c3d4e5f' }
    expect(saveCategoryRule.body?.safeParse({ ...rule, matcherValue: 'x'.repeat(MATCHER_VALUE_MAX_LENGTH) }).success).toBe(true)
    expect(saveCategoryRule.body?.safeParse({ ...rule, matcherValue: 'x'.repeat(MATCHER_VALUE_MAX_LENGTH + 1) }).success).toBe(false)
  })

  it('takes a category with only what a form asks for, and refuses an icon it has never heard of', () => {
    const parsed = createCategory.body?.parse({ name: '  Coffee ', kind: 'expense', icon: 'coffee' })
    expect(parsed).toEqual({ name: 'Coffee', kind: 'expense', parentId: null, icon: 'coffee', colorToken: 'ink-muted' })
    expect(createCategory.body?.safeParse({ name: 'Coffee', kind: 'expense', icon: 'espresso-machine' }).success).toBe(false)
  })
})
