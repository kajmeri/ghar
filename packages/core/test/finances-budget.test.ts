import { describe, expect, it } from 'vitest';
import { ConflictError, ValidationError } from '../src/errors';
import {
  addMonths,
  assertCanCloseBudget,
  assertMonthStart,
  assertPlannedCents,
  budgetPace,
  budgetStatus,
  closeBudget,
  copyBudgetLines,
  daysInPeriod,
  elapsedShare,
  formatPeriod,
  monthStart,
  notableChanges,
  periodEnd,
  recentMonths,
  rolloverOutCents,
  spendByTopLevelCategory,
  summarizeBudget,
  type BudgetCategory,
  type BudgetLineInput,
} from '../src/finances';

describe('periods', () => {
  it('names a month by its first day', () => {
    expect(monthStart('2026-09-13')).toBe('2026-09-01');
    expect(assertMonthStart('2026-09-01')).toBe('2026-09-01');
    expect(() => assertMonthStart('2026-09-02')).toThrow(ValidationError);
    expect(() => assertMonthStart('2026-13-01')).toThrow(ValidationError);
  });

  it('moves between months across years and leap days', () => {
    expect(addMonths('2026-12-01', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01');
    expect(periodEnd('2028-02-01')).toBe('2028-03-01');
    expect(daysInPeriod('2028-02-01')).toBe(29);
    expect(daysInPeriod('2026-02-01')).toBe(28);
    expect(() => addMonths('2026-01-01', 1.5)).toThrow(ValidationError);
  });

  it('formats a period for people', () => {
    expect(formatPeriod('2026-09-01')).toBe('September 2026');
  });

  it('counts today as gone when working out how much of the month has passed', () => {
    expect(elapsedShare('2026-09-01', '2026-09-01')).toBeCloseTo(1 / 30);
    expect(elapsedShare('2026-09-01', '2026-09-15')).toBe(0.5);
    expect(elapsedShare('2026-09-01', '2026-09-30')).toBe(1);
    expect(elapsedShare('2026-09-01', '2026-10-04')).toBe(1);
    expect(elapsedShare('2026-09-01', '2026-08-31')).toBe(0);
  });

  it('lists recent months oldest first, ending with this one', () => {
    expect(recentMonths('2026-02-17', 6)).toEqual([
      '2025-09-01',
      '2025-10-01',
      '2025-11-01',
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
    ]);
  });
});

describe('status and pace', () => {
  it('uses the shared progress thresholds', () => {
    expect(budgetStatus(7_999, 10_000)).toBe('under');
    expect(budgetStatus(8_000, 10_000)).toBe('approaching');
    expect(budgetStatus(10_000, 10_000)).toBe('approaching');
    expect(budgetStatus(10_001, 10_000)).toBe('over');
  });

  it('treats an overspent rollover as nothing available', () => {
    expect(budgetStatus(1, -500)).toBe('over');
  });

  it('compares the share spent with the share of the month gone', () => {
    expect(budgetPace(5_000, 10_000, 0.5)).toBe('on_pace');
    expect(budgetPace(5_400, 10_000, 0.5)).toBe('on_pace');
    expect(budgetPace(5_600, 10_000, 0.5)).toBe('over_pace');
    expect(budgetPace(4_400, 10_000, 0.5)).toBe('under_pace');
    expect(budgetPace(1, 0, 0.5)).toBe('over_pace');
    expect(budgetPace(0, 0, 0.5)).toBe('on_pace');
  });

  it('refuses planned amounts that are negative, fractional or absurd', () => {
    expect(assertPlannedCents(0)).toBe(0);
    expect(() => assertPlannedCents(-1)).toThrow(ValidationError);
    expect(() => assertPlannedCents(10.5)).toThrow(ValidationError);
    expect(() => assertPlannedCents(1_000_000_001)).toThrow(ValidationError);
  });
});

const CATEGORIES: BudgetCategory[] = [
  { id: 'food', parentId: null, kind: 'expense' },
  { id: 'groceries', parentId: 'food', kind: 'expense' },
  { id: 'coffee', parentId: 'food', kind: 'expense' },
  { id: 'fuel', parentId: null, kind: 'expense' },
  { id: 'travel', parentId: null, kind: 'expense' },
  { id: 'paychecks', parentId: null, kind: 'income' },
  { id: 'transfers', parentId: null, kind: 'transfer' },
];

function line(id: string, overrides: Partial<BudgetLineInput> = {}): BudgetLineInput {
  return {
    id,
    categoryId: id.replace('line-', ''),
    plannedCents: 10_000,
    rolloverEnabled: false,
    rolloverInCents: 0,
    actualCents: null,
    ...overrides,
  };
}

describe('summarizeBudget', () => {
  it('rolls child spending into a parent line unless the child has its own line', () => {
    const summary = summarizeBudget({
      lines: [
        line('line-food', { plannedCents: 60_000 }),
        line('line-coffee', { plannedCents: 3_000 }),
      ],
      categories: CATEGORIES,
      spend: [
        { categoryId: 'food', spentCents: 1_000 },
        { categoryId: 'groceries', spentCents: 20_000 },
        { categoryId: 'coffee', spentCents: 2_500 },
      ],
      elapsedShare: 0.5,
      snapshot: null,
    });

    expect(summary.lines.map((summaryLine) => [summaryLine.id, summaryLine.actualCents])).toEqual([
      ['line-food', 21_000],
      ['line-coffee', 2_500],
    ]);
    expect(summary.lines[1]).toMatchObject({
      availableCents: 3_000,
      remainingCents: 500,
      status: 'approaching',
      pace: 'over_pace',
    });
  });

  it('keeps unbudgeted and uncategorized spending out of lines but in the total', () => {
    const summary = summarizeBudget({
      lines: [line('line-fuel', { plannedCents: 20_000 })],
      categories: CATEGORIES,
      spend: [
        { categoryId: 'fuel', spentCents: 4_000 },
        { categoryId: 'travel', spentCents: 30_000 },
        { categoryId: null, spentCents: 1_234 },
      ],
      elapsedShare: 0.2,
      snapshot: null,
    });

    expect(summary.unbudgetedCents).toBe(30_000);
    expect(summary.uncategorizedCents).toBe(1_234);
    expect(summary.total).toEqual({
      plannedCents: 20_000,
      availableCents: 20_000,
      spentCents: 35_234,
      remainingCents: -15_234,
      status: 'over',
      pace: 'over_pace',
    });
  });

  it('ignores income and transfer categories', () => {
    const summary = summarizeBudget({
      lines: [],
      categories: CATEGORIES,
      spend: [
        { categoryId: 'paychecks', spentCents: -500_000 },
        { categoryId: 'transfers', spentCents: 90_000 },
      ],
      elapsedShare: 0.5,
      snapshot: null,
    });
    expect(summary.total.spentCents).toBe(0);
    expect(summary.unbudgetedCents).toBe(0);
  });

  it('lets refunds bring a line down', () => {
    const summary = summarizeBudget({
      lines: [line('line-travel')],
      categories: CATEGORIES,
      spend: [{ categoryId: 'travel', spentCents: -2_000 }],
      elapsedShare: 0.5,
      snapshot: null,
    });
    expect(summary.lines[0]).toMatchObject({ actualCents: -2_000, remainingCents: 12_000 });
  });

  it('adds what rolled in to what is available', () => {
    const summary = summarizeBudget({
      lines: [
        line('line-fuel', { rolloverEnabled: true, rolloverInCents: 2_500 }),
        line('line-travel', { rolloverEnabled: true, rolloverInCents: -4_000 }),
      ],
      categories: CATEGORIES,
      spend: [
        { categoryId: 'fuel', spentCents: 11_000 },
        { categoryId: 'travel', spentCents: 5_000 },
      ],
      elapsedShare: 0.9,
      snapshot: null,
    });
    expect(summary.lines[0]).toMatchObject({ availableCents: 12_500, remainingCents: 1_500 });
    expect(summary.lines[1]).toMatchObject({
      availableCents: 6_000,
      remainingCents: 1_000,
      status: 'approaching',
    });
  });

  it('reads a closed month from its snapshot, not from transactions', () => {
    const summary = summarizeBudget({
      lines: [line('line-fuel', { actualCents: 9_000 })],
      categories: CATEGORIES,
      spend: [
        { categoryId: 'fuel', spentCents: 99_999 },
        { categoryId: null, spentCents: 99_999 },
      ],
      elapsedShare: 1,
      snapshot: { unbudgetedCents: 700, uncategorizedCents: 300 },
    });
    expect(summary.lines[0]?.actualCents).toBe(9_000);
    expect(summary.total.spentCents).toBe(10_000);
  });

  it('totals an empty budget as nothing', () => {
    const summary = summarizeBudget({
      lines: [],
      categories: CATEGORIES,
      spend: [],
      elapsedShare: 0.5,
      snapshot: null,
    });
    expect(summary.total).toMatchObject({ plannedCents: 0, spentCents: 0, pace: 'on_pace' });
  });
});

describe('rollover, copying and closing', () => {
  it('carries what was left, or the overspend, only on rollover lines', () => {
    expect(
      rolloverOutCents({ rolloverEnabled: true, availableCents: 10_000, actualCents: 7_000 }),
    ).toBe(3_000);
    expect(
      rolloverOutCents({ rolloverEnabled: true, availableCents: 10_000, actualCents: 12_500 }),
    ).toBe(-2_500);
    expect(
      rolloverOutCents({ rolloverEnabled: false, availableCents: 10_000, actualCents: 0 }),
    ).toBe(0);
  });

  it('copies plans and settings, with rollover amounts only from a closed month', () => {
    const lines = [
      line('line-fuel', { rolloverEnabled: true, rolloverInCents: 1_000, actualCents: 8_000 }),
      line('line-travel', { plannedCents: 50_000, actualCents: 10_000 }),
    ];
    expect(copyBudgetLines({ lines, closed: true })).toEqual([
      { categoryId: 'fuel', plannedCents: 10_000, rolloverEnabled: true, rolloverInCents: 3_000 },
      { categoryId: 'travel', plannedCents: 50_000, rolloverEnabled: false, rolloverInCents: 0 },
    ]);
    expect(copyBudgetLines({ lines, closed: false })[0]?.rolloverInCents).toBe(0);
  });

  it('closes a month only once it is over, and only once', () => {
    expect(() => {
      assertCanCloseBudget({ periodStart: '2026-09-01', closedAt: null, today: '2026-09-30' });
    }).toThrow(ConflictError);
    expect(() => {
      assertCanCloseBudget({ periodStart: '2026-09-01', closedAt: null, today: '2026-10-01' });
    }).not.toThrow();
    expect(() => {
      assertCanCloseBudget({
        periodStart: '2026-08-01',
        closedAt: new Date('2026-09-02T00:00:00Z'),
        today: '2026-10-01',
      });
    }).toThrow(ConflictError);
  });

  it('snapshots actuals and works out rollovers when closing', () => {
    const summary = summarizeBudget({
      lines: [
        line('line-fuel', { rolloverEnabled: true, rolloverInCents: 500 }),
        line('line-travel'),
      ],
      categories: CATEGORIES,
      spend: [
        { categoryId: 'fuel', spentCents: 12_000 },
        { categoryId: 'travel', spentCents: 4_000 },
        { categoryId: 'groceries', spentCents: 800 },
        { categoryId: null, spentCents: 200 },
      ],
      elapsedShare: 1,
      snapshot: null,
    });
    expect(closeBudget(summary)).toEqual({
      lines: [
        { id: 'line-fuel', actualCents: 12_000 },
        { id: 'line-travel', actualCents: 4_000 },
      ],
      unbudgetedCents: 800,
      uncategorizedCents: 200,
      rollovers: [{ categoryId: 'fuel', rolloverInCents: -1_500 }],
    });
  });
});

describe('insights', () => {
  const months = ['2026-06-01', '2026-07-01', '2026-08-01'];
  const categories = [
    { id: 'food', parentId: null, kind: 'expense' as const },
    { id: 'groceries', parentId: 'food', kind: 'expense' as const },
    { id: 'travel', parentId: null, kind: 'expense' as const },
    { id: 'fuel', parentId: null, kind: 'expense' as const },
    { id: 'paychecks', parentId: null, kind: 'income' as const },
  ];

  it('rolls spending up to top-level categories per month, uncategorized last', () => {
    const { series, monthTotals } = spendByTopLevelCategory(
      [
        { month: '2026-06-01', categoryId: 'groceries', spentCents: 40_000 },
        { month: '2026-06-01', categoryId: 'food', spentCents: 5_000 },
        { month: '2026-07-01', categoryId: 'travel', spentCents: 90_000 },
        { month: '2026-07-01', categoryId: null, spentCents: 1_000 },
        { month: '2026-08-01', categoryId: 'paychecks', spentCents: -800_000 },
        { month: '2025-01-01', categoryId: 'travel', spentCents: 1 },
      ],
      categories,
      months,
    );

    expect(series).toEqual([
      { categoryId: 'travel', monthlyCents: [0, 90_000, 0], totalCents: 90_000 },
      { categoryId: 'food', monthlyCents: [45_000, 0, 0], totalCents: 45_000 },
      { categoryId: null, monthlyCents: [0, 1_000, 0], totalCents: 1_000 },
    ]);
    expect(monthTotals).toEqual([45_000, 91_000, 0]);
  });

  it('points out big changes, biggest first, and ignores small ones', () => {
    const { series } = spendByTopLevelCategory(
      [
        { month: '2026-07-01', categoryId: 'food', spentCents: 40_000 },
        { month: '2026-08-01', categoryId: 'food', spentCents: 60_000 },
        { month: '2026-07-01', categoryId: 'travel', spentCents: 120_000 },
        { month: '2026-08-01', categoryId: 'travel', spentCents: 10_000 },
        { month: '2026-07-01', categoryId: 'fuel', spentCents: 10_000 },
        { month: '2026-08-01', categoryId: 'fuel', spentCents: 14_000 },
        { month: '2026-08-01', categoryId: null, spentCents: 500_000 },
      ],
      categories,
      months,
    );

    expect(notableChanges(series, months, { monthIndex: 2 })).toEqual([
      {
        categoryId: 'travel',
        month: '2026-08-01',
        previousMonth: '2026-07-01',
        currentCents: 10_000,
        previousCents: 120_000,
        changeCents: -110_000,
        changeShare: -110_000 / 120_000,
      },
      {
        categoryId: 'food',
        month: '2026-08-01',
        previousMonth: '2026-07-01',
        currentCents: 60_000,
        previousCents: 40_000,
        changeCents: 20_000,
        changeShare: 0.5,
      },
    ]);
  });

  it('notes new spending with no share, and needs a month before to compare', () => {
    const { series } = spendByTopLevelCategory(
      [{ month: '2026-08-01', categoryId: 'travel', spentCents: 70_000 }],
      categories,
      months,
    );
    expect(notableChanges(series, months, { monthIndex: 2 })[0]).toMatchObject({
      changeCents: 70_000,
      changeShare: null,
    });
    expect(notableChanges(series, months, { monthIndex: 0 })).toEqual([]);
  });
});
