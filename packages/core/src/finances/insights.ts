import type { CalendarDate } from '../dates';
import type { Cents } from '../money';
import { addMonths, monthStart } from './budget';
import type { CategoryKind } from './types';

/** A change smaller than this, in either direction, isn't worth pointing out. */
export const NOTABLE_CHANGE_MIN_CENTS = 5_000;
/** Nor is one smaller than this share of the month before. */
export const NOTABLE_CHANGE_MIN_SHARE = 0.25;

export interface InsightCategory {
  id: string;
  parentId: string | null;
  kind: CategoryKind;
}

/** Spending in one category in one month. Positive is money spent. */
export interface MonthlyCategorySpend {
  /** The month's first day. */
  month: CalendarDate;
  /** Null for money out with no category. */
  categoryId: string | null;
  spentCents: Cents;
}

export interface CategorySpendSeries {
  /** A top-level category, or null for uncategorized. */
  categoryId: string | null;
  /** One figure per month, oldest first, in the order of `months`. */
  monthlyCents: Cents[];
  totalCents: Cents;
}

/** The first day of each of the last `count` months, oldest first, ending with today's month. */
export function recentMonths(today: CalendarDate, count: number): CalendarDate[] {
  const current = monthStart(today);
  return Array.from({ length: count }, (_, index) => addMonths(current, index - count + 1));
}

/**
 * Spending per top-level expense category per month. A child category's spending counts toward
 * its parent. Biggest total first, with uncategorized last.
 */
export function spendByTopLevelCategory(
  rows: readonly MonthlyCategorySpend[],
  categories: readonly InsightCategory[],
  months: readonly CalendarDate[],
): { series: CategorySpendSeries[]; monthTotals: Cents[] } {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const monthIndex = new Map(months.map((month, index) => [month, index]));
  const series = new Map<string | null, CategorySpendSeries>();
  const monthTotals = months.map(() => 0);

  for (const row of rows) {
    const index = monthIndex.get(row.month);
    if (index === undefined) continue;
    let topId: string | null = null;
    if (row.categoryId !== null) {
      const category = byId.get(row.categoryId);
      if (category && category.kind !== 'expense') continue;
      topId = category?.parentId ?? row.categoryId;
    }

    let entry = series.get(topId);
    if (!entry) {
      entry = { categoryId: topId, monthlyCents: months.map(() => 0), totalCents: 0 };
      series.set(topId, entry);
    }
    entry.monthlyCents[index] = (entry.monthlyCents[index] ?? 0) + row.spentCents;
    entry.totalCents += row.spentCents;
    monthTotals[index] = (monthTotals[index] ?? 0) + row.spentCents;
  }

  return {
    series: [...series.values()].sort((a, b) => {
      if (a.categoryId === null) return 1;
      if (b.categoryId === null) return -1;
      return b.totalCents - a.totalCents;
    }),
    monthTotals,
  };
}

export interface SpendChange {
  categoryId: string;
  month: CalendarDate;
  previousMonth: CalendarDate;
  currentCents: Cents;
  previousCents: Cents;
  /** Positive when spending went up. */
  changeCents: Cents;
  /** The change as a share of the month before, or null when that month had nothing. */
  changeShare: number | null;
}

/**
 * Categories whose spending moved enough between two months to mention: by at least
 * NOTABLE_CHANGE_MIN_CENTS and at least NOTABLE_CHANGE_MIN_SHARE of the earlier month. Biggest
 * move first. Uncategorized spending is left out; the review queue covers it.
 */
export function notableChanges(
  series: readonly CategorySpendSeries[],
  months: readonly CalendarDate[],
  options: { monthIndex: number; limit?: number },
): SpendChange[] {
  const { monthIndex, limit = 4 } = options;
  const month = months[monthIndex];
  const previousMonth = months[monthIndex - 1];
  if (month === undefined || previousMonth === undefined) return [];

  const changes: SpendChange[] = [];
  for (const entry of series) {
    if (entry.categoryId === null) continue;
    const currentCents = entry.monthlyCents[monthIndex] ?? 0;
    const previousCents = entry.monthlyCents[monthIndex - 1] ?? 0;
    const changeCents = currentCents - previousCents;
    if (Math.abs(changeCents) < NOTABLE_CHANGE_MIN_CENTS) continue;
    const changeShare = previousCents > 0 ? changeCents / previousCents : null;
    if (changeShare !== null && Math.abs(changeShare) < NOTABLE_CHANGE_MIN_SHARE) continue;
    changes.push({
      categoryId: entry.categoryId,
      month,
      previousMonth,
      currentCents,
      previousCents,
      changeCents,
      changeShare,
    });
  }
  return changes.sort((a, b) => Math.abs(b.changeCents) - Math.abs(a.changeCents)).slice(0, limit);
}
