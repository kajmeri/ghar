import { describe, expect, it } from 'vitest'
import { addCalendarDays, type CalendarDate } from '../src/dates'
import { ValidationError } from '../src/errors'
import {
  BALANCE_SIGN,
  STALE_BALANCE_HOURS,
  allocation,
  balanceSide,
  balanceTypeLabel,
  cashAndCards,
  computeDeltas,
  goalSavedCents,
  groupNetWorthAccounts,
  manualValueReminders,
  monthTicks,
  netWorthChart,
  niceDomain,
  periodStartFor,
  planLinkedAccountSnapshot,
  planManualAccountSnapshot,
  rollupSnapshots,
  signedBalanceCents,
  sortDebts,
  splitContributionFromMarket,
  summarizeReadings,
  upcomingDebtPayments,
  validateHistoricalSnapshot,
  validateManualAccount,
  validateManualValue,
  wholeMonthsBetween,
  type NetWorthSnapshot,
} from '../src/finances'

function fieldErrors(run: () => unknown): Record<string, string[]> | undefined {
  try {
    run()
  } catch (error) {
    if (error instanceof ValidationError) {
      return (error.details as { fieldErrors?: Record<string, string[]> }).fieldErrors
    }
    throw error
  }
  return undefined
}

function eachDay(from: CalendarDate, to: CalendarDate): CalendarDate[] {
  const days: CalendarDate[] = []
  for (let day = from; day <= to; day = addCalendarDays(day, 1)) days.push(day)
  return days
}

describe('signs', () => {
  it('negates what is owed and keeps what is owned', () => {
    expect(signedBalanceCents('depository', 12_345)).toBe(12_345)
    expect(signedBalanceCents('investment', 12_345)).toBe(12_345)
    expect(signedBalanceCents('credit', 12_345)).toBe(-12_345)
    expect(signedBalanceCents('loan', 12_345)).toBe(-12_345)
    expect(signedBalanceCents('property', 40_000_000)).toBe(40_000_000)
    expect(signedBalanceCents('other_liability', 500)).toBe(-500)
  })

  it('keeps a credit card in credit as a positive, and never returns negative zero', () => {
    // Plaid reports an overpaid card as a negative amount owed: money the bank owes back.
    expect(signedBalanceCents('credit', -2_000)).toBe(2_000)
    expect(Object.is(signedBalanceCents('loan', 0), 0)).toBe(true)
  })

  it('counts a type it has never seen as owned, like Plaid "other"', () => {
    expect(balanceSide('something_new')).toBe('asset')
    expect(balanceSide('toString')).toBe('asset')
    expect(Object.values(BALANCE_SIGN).every(sign => sign === 1 || sign === -1)).toBe(true)
  })

  it('keeps goals off debt accounts through the same table', () => {
    expect(goalSavedCents({ type: 'loan', currentBalanceCents: 5_000 })).toBeNull()
    expect(goalSavedCents({ type: 'other_liability', currentBalanceCents: 5_000 })).toBeNull()
    expect(goalSavedCents({ type: 'depository', currentBalanceCents: 5_000 })).toBe(5_000)
  })
})

describe('planLinkedAccountSnapshot', () => {
  const now = new Date('2026-09-14T12:00:00Z')
  const fresh = {
    type: 'credit',
    currentBalanceCents: 84_000,
    balanceUpdatedAt: new Date('2026-09-14T06:00:00Z'),
    itemStatus: 'good',
    previousBalanceCents: -80_000,
  }

  it('takes a fresh balance and signs it', () => {
    expect(planLinkedAccountSnapshot(fresh, now)).toEqual({ balanceCents: -84_000, isStale: false })
  })

  it(`flags a balance older than ${STALE_BALANCE_HOURS} hours and carries it rather than zeroing it`, () => {
    const edge = new Date(now.getTime() - STALE_BALANCE_HOURS * 60 * 60 * 1000)
    expect(planLinkedAccountSnapshot({ ...fresh, balanceUpdatedAt: edge }, now)?.isStale).toBe(false)
    const old = new Date(edge.getTime() - 60_000)
    expect(planLinkedAccountSnapshot({ ...fresh, balanceUpdatedAt: old }, now)).toEqual({ balanceCents: -84_000, isStale: true })
  })

  it('stops reading a connection the household turned off, however recent its balance', () => {
    // Earlier days keep their readings; from today on Ghar stops claiming to know the balance.
    expect(planLinkedAccountSnapshot({ ...fresh, itemStatus: 'disconnected' }, now)).toBeNull()
  })

  it('flags a bank that needs signing in again however recent its balance', () => {
    expect(planLinkedAccountSnapshot({ ...fresh, itemStatus: 'login_required' }, now)).toEqual({ balanceCents: -84_000, isStale: true })
  })

  it('falls back to the last snapshot when the account has no balance, and to nothing only when there never was one', () => {
    expect(planLinkedAccountSnapshot({ ...fresh, currentBalanceCents: null }, now)).toEqual({ balanceCents: -80_000, isStale: true })
    expect(planLinkedAccountSnapshot({ ...fresh, currentBalanceCents: null, previousBalanceCents: null }, now)).toBeNull()
  })
})

describe('planManualAccountSnapshot and summarizeReadings', () => {
  it('signs a manual loan and skips an account with no value', () => {
    expect(planManualAccountSnapshot({ kind: 'loan', latestValueCents: 250_000 })).toEqual({ balanceCents: -250_000, isStale: false })
    expect(planManualAccountSnapshot({ kind: 'property', latestValueCents: null })).toBeNull()
  })

  it('adds up a household day, with a paid-off loan counted at zero', () => {
    expect(
      summarizeReadings([
        { balanceCents: 500_000, isStale: false },
        { balanceCents: -120_000, isStale: true },
        { balanceCents: 40_000_000, isStale: false },
        { balanceCents: 0, isStale: false },
      ])
    ).toEqual({ assetsCents: 40_500_000, liabilitiesCents: -120_000, netCents: 40_380_000, accountCount: 4, staleAccountCount: 1 })
    expect(summarizeReadings([])).toEqual({ assetsCents: 0, liabilitiesCents: 0, netCents: 0, accountCount: 0, staleAccountCount: 0 })
  })

  it('counts an overdrawn checking account as owed and a card in credit as owned', () => {
    const overdrawn = planLinkedAccountSnapshot(
      {
        type: 'depository',
        currentBalanceCents: -3_000,
        balanceUpdatedAt: new Date('2026-09-13T12:00:00Z'),
        itemStatus: 'good',
        previousBalanceCents: null,
      },
      new Date('2026-09-13T15:00:00Z')
    )
    const cardInCredit = planLinkedAccountSnapshot(
      {
        type: 'credit',
        currentBalanceCents: -2_000,
        balanceUpdatedAt: new Date('2026-09-13T12:00:00Z'),
        itemStatus: 'good',
        previousBalanceCents: null,
      },
      new Date('2026-09-13T15:00:00Z')
    )
    if (overdrawn === null || cardInCredit === null) throw new Error('expected readings')
    expect(summarizeReadings([overdrawn, cardInCredit])).toEqual({
      assetsCents: 2_000,
      liabilitiesCents: -3_000,
      netCents: -1_000,
      accountCount: 2,
      staleAccountCount: 0,
    })
  })
})

describe('rollupSnapshots', () => {
  // An account that went stale on Feb 11 and stayed stale through March.
  const accountDays = [
    { asOf: '2026-04-30', balanceCents: 112_000, isStale: false },
    { asOf: '2026-01-15', balanceCents: 100_000, isStale: false },
    { asOf: '2026-02-11', balanceCents: 104_000, isStale: true },
    { asOf: '2026-01-31', balanceCents: 102_000, isStale: false },
    { asOf: '2026-02-10', balanceCents: 104_000, isStale: false },
    { asOf: '2026-03-31', balanceCents: 104_000, isStale: true },
    { asOf: '2026-02-28', balanceCents: 104_000, isStale: true },
    { asOf: '2026-04-02', balanceCents: 111_000, isStale: false },
  ]

  it('keeps the last reading of each month, not the average, through a stale month', () => {
    expect(rollupSnapshots(accountDays, 'month')).toEqual([
      { asOf: '2026-01-31', balanceCents: 102_000, isStale: false },
      { asOf: '2026-02-28', balanceCents: 104_000, isStale: true },
      { asOf: '2026-03-31', balanceCents: 104_000, isStale: true },
      { asOf: '2026-04-30', balanceCents: 112_000, isStale: false },
    ])
  })

  it('starts weeks on Monday and keeps the later of two rows on one day', () => {
    expect(periodStartFor('2026-09-13', 'week')).toBe('2026-09-07')
    expect(periodStartFor('2026-09-14', 'week')).toBe('2026-09-14')
    const rows = [
      { asOf: '2026-09-07', n: 1 },
      { asOf: '2026-09-13', n: 2 },
      { asOf: '2026-09-14', n: 3 },
      { asOf: '2026-09-14', n: 4 },
    ]
    expect(rollupSnapshots(rows, 'week').map(row => row.n)).toEqual([2, 4])
    expect(rollupSnapshots(rows, 'day').map(row => row.n)).toEqual([1, 2, 4])
    expect(rollupSnapshots([], 'month')).toEqual([])
  })
})

describe('computeDeltas', () => {
  it('compares the latest reading with the newest one a month, a year and all time before', () => {
    const deltas = computeDeltas([
      { asOf: '2026-09-14', netCents: 1_200_000, staleAccountCount: 0 },
      { asOf: '2025-09-01', netCents: 1_000_000, staleAccountCount: 0 },
      { asOf: '2025-09-14', netCents: 1_050_000, staleAccountCount: 0 },
      { asOf: '2026-08-10', netCents: 1_180_000, staleAccountCount: 0 },
      { asOf: '2026-08-20', netCents: 1_190_000, staleAccountCount: 0 },
    ])
    expect(deltas.month).toEqual({
      fromOn: '2026-08-10',
      toOn: '2026-09-14',
      cents: 20_000,
      percent: (20_000 / 1_180_000) * 100,
      includesStale: false,
    })
    expect(deltas.year).toMatchObject({ fromOn: '2025-09-14', cents: 150_000 })
    expect(deltas.allTime).toMatchObject({ fromOn: '2025-09-01', cents: 200_000, percent: 20 })
  })

  it('says when a month ends on a stale reading', () => {
    const deltas = computeDeltas([
      { asOf: '2026-02-28', netCents: 900_000, staleAccountCount: 0 },
      { asOf: '2026-03-31', netCents: 900_000, staleAccountCount: 2 },
    ])
    expect(deltas.month).toEqual({ fromOn: '2026-02-28', toOn: '2026-03-31', cents: 0, percent: 0, includesStale: true })
    expect(deltas.year).toBeNull()
  })

  it('has no month or year delta without history that old, and no all-time delta from one day', () => {
    expect(computeDeltas([])).toEqual({ month: null, year: null, allTime: null })
    expect(computeDeltas([{ asOf: '2026-09-14', netCents: 5 }])).toEqual({ month: null, year: null, allTime: null })
    const week = computeDeltas([
      { asOf: '2026-09-07', netCents: 100 },
      { asOf: '2026-09-14', netCents: 200 },
    ])
    expect(week.month).toBeNull()
    expect(week.allTime).toMatchObject({ cents: 100, percent: 100 })
  })

  it('reads a shrinking debt as a rise, and gives no percent from zero', () => {
    const debt = computeDeltas([
      { asOf: '2025-01-01', netCents: -200_000 },
      { asOf: '2026-01-01', netCents: -100_000 },
    ])
    expect(debt.year).toMatchObject({ cents: 100_000, percent: 50 })
    const fromZero = computeDeltas([
      { asOf: '2025-01-01', netCents: 0 },
      { asOf: '2026-01-01', netCents: 100_000 },
    ])
    expect(fromZero.year).toMatchObject({ cents: 100_000, percent: null })
  })
})

describe('allocation', () => {
  const holdings = [
    { ticker: 'VTI', name: 'Vanguard Total Stock Market ETF', securityType: 'etf', valueCents: 600_000, costBasisCents: 400_000 },
    { ticker: 'vti ', name: 'Vanguard Total Stock Market ETF', securityType: 'etf', valueCents: 200_000, costBasisCents: 150_000 },
    { ticker: 'AAPL', name: 'Apple Inc.', securityType: 'equity', valueCents: 150_000, costBasisCents: null },
    { ticker: null, name: 'Cash sweep', securityType: 'cash', valueCents: 50_000, costBasisCents: null },
  ]

  it('breaks holdings down by type, largest first', () => {
    const result = allocation(holdings)
    expect(result.totalCents).toBe(1_000_000)
    expect(result.byType).toEqual([
      { key: 'etf', label: 'ETFs', valueCents: 800_000, share: 0.8 },
      { key: 'equity', label: 'Stocks', valueCents: 150_000, share: 0.15 },
      { key: 'cash', label: 'Cash', valueCents: 50_000, share: 0.05 },
    ])
  })

  it('merges the same ticker across accounts and keeps its gain', () => {
    const [vti, apple, cash] = allocation(holdings).byTicker
    expect(vti).toMatchObject({ ticker: 'VTI', valueCents: 800_000, share: 0.8, costBasisCents: 550_000, gainCents: 250_000 })
    expect(vti?.gainPercent).toBeCloseTo(45.4545, 3)
    expect(apple).toMatchObject({ ticker: 'AAPL', costBasisCents: null, gainCents: null, gainPercent: null })
    expect(cash).toMatchObject({ key: 'name:cash sweep', ticker: null, label: 'Cash sweep' })
  })

  it('reports unrealized gain only over holdings with a cost basis', () => {
    expect(allocation(holdings).gain).toEqual({
      valueCents: 800_000,
      costBasisCents: 550_000,
      gainCents: 250_000,
      percent: (250_000 / 550_000) * 100,
      coveredShare: 0.8,
    })
  })

  it('treats a merged basis with a missing piece as unknown, and odd types as other', () => {
    const result = allocation([
      { ticker: 'AAPL', name: 'Apple', securityType: 'equity', valueCents: 100, costBasisCents: 80 },
      { ticker: 'AAPL', name: 'Apple', securityType: 'equity', valueCents: 100, costBasisCents: null },
      { ticker: 'XYZ', name: null, securityType: 'warrant', valueCents: 50, costBasisCents: null },
    ])
    expect(result.byTicker[0]).toMatchObject({ ticker: 'AAPL', costBasisCents: null, gainCents: null })
    expect(result.byTicker[1]).toMatchObject({ label: 'XYZ' })
    expect(result.byType.map(slice => slice.key)).toEqual(['equity', 'other'])
    expect(result.gain).toMatchObject({ valueCents: 100, costBasisCents: 80, gainCents: 20 })
  })

  it('has nothing to show for no holdings', () => {
    expect(allocation([])).toEqual({ totalCents: 0, byType: [], byTicker: [], gain: null })
  })
})

describe('splitContributionFromMarket', () => {
  it('separates money put in from market movement', () => {
    const split = splitContributionFromMarket(
      [
        { asOf: '2026-01-31', balanceCents: 100_000 },
        { asOf: '2026-02-28', balanceCents: 115_000 },
      ],
      [
        { date: '2026-01-31', amountCents: 99_999 }, // on the start day: already in the starting balance
        { date: '2026-02-15', amountCents: 10_000 },
        { date: '2026-02-20', amountCents: -2_000 },
        { date: '2026-02-28', amountCents: 1_000 },
        { date: '2026-03-01', amountCents: 50_000 },
      ]
    )
    expect(split.periods).toEqual([
      {
        fromOn: '2026-01-31',
        toOn: '2026-02-28',
        startCents: 100_000,
        endCents: 115_000,
        changeCents: 15_000,
        contributionsCents: 9_000,
        marketCents: 6_000,
        stale: false,
      },
    ])
    expect(split.totals).toEqual({ changeCents: 15_000, contributionsCents: 9_000, marketCents: 6_000 })
  })

  it('refuses to call a stale month market movement, but still totals across it', () => {
    // Rolled up from the daily rows: the account went stale in February and stayed flat through March.
    const months = rollupSnapshots(
      [
        { asOf: '2026-01-31', balanceCents: 102_000, isStale: false },
        { asOf: '2026-02-28', balanceCents: 104_000, isStale: true },
        { asOf: '2026-03-31', balanceCents: 104_000, isStale: true },
        { asOf: '2026-04-30', balanceCents: 112_000, isStale: false },
      ],
      'month'
    )
    const split = splitContributionFromMarket(months, [
      { date: '2026-02-05', amountCents: 1_000 },
      { date: '2026-03-05', amountCents: 5_000 },
    ])
    expect(
      split.periods.map(period => [period.toOn, period.changeCents, period.contributionsCents, period.marketCents, period.stale])
    ).toEqual([
      ['2026-02-28', 2_000, 1_000, null, true],
      ['2026-03-31', 0, 5_000, null, true],
      ['2026-04-30', 8_000, 0, null, true],
    ])
    expect(split.totals).toEqual({ changeCents: 10_000, contributionsCents: 6_000, marketCents: 4_000 })
  })

  it('has no market total when the latest reading is stale, and nothing from one reading', () => {
    const endsStale = splitContributionFromMarket(
      [
        { asOf: '2026-01-31', balanceCents: 100 },
        { asOf: '2026-02-28', balanceCents: 100, isStale: true },
      ],
      []
    )
    expect(endsStale.totals.marketCents).toBeNull()
    expect(splitContributionFromMarket([{ asOf: '2026-01-31', balanceCents: 100 }], [])).toEqual({
      periods: [],
      totals: { changeCents: 0, contributionsCents: 0, marketCents: 0 },
    })
    expect(splitContributionFromMarket([], []).totals.marketCents).toBeNull()
  })
})

describe('netWorthChart', () => {
  const today = '2026-09-14'

  // 18 months, with a stale stretch in February and a car loan paid off in June.
  function eighteenMonths(): NetWorthSnapshot[] {
    return eachDay('2025-03-15', today).map((asOf, index) => {
      const stale = asOf >= '2026-02-01' && asOf <= '2026-02-20'
      const liabilitiesCents = asOf >= '2026-06-01' ? 0 : -(1_500_000 - index * 3_000)
      const assetsCents = 8_000_000 + index * 2_000
      return {
        asOf,
        source: 'automatic',
        assetsCents,
        liabilitiesCents,
        netCents: assetsCents + liabilitiesCents,
        accountCount: 6,
        staleAccountCount: stale ? 1 : 0,
      }
    })
  }

  it('explains an empty history rather than drawing it', () => {
    const chart = netWorthChart([], { range: '1Y', today })
    expect(chart).toMatchObject({
      status: 'empty',
      points: [],
      staleRanges: [],
      xTicks: [],
      historyStartsOn: null,
      trackingStartedOn: null,
    })
  })

  it('calls a few days a start, not a chart', () => {
    const rows = eighteenMonths().slice(-3)
    expect(netWorthChart(rows, { range: '1Y', today }).status).toBe('starting')
  })

  it('draws a year day by day with the stale stretch marked', () => {
    const chart = netWorthChart(eighteenMonths(), { range: '1Y', today })
    expect(chart.status).toBe('ready')
    expect(chart.granularity).toBe('day')
    expect(chart.points[0]?.asOf).toBe('2025-09-14')
    expect(chart.points).toHaveLength(366)
    expect(chart.staleRanges).toEqual([{ fromOn: '2026-02-01', toOn: '2026-02-20' }])
    expect(chart.xTicks).toEqual(['2025-10-01', '2026-01-01', '2026-04-01', '2026-07-01'])

    const paidOff = chart.points.find(point => point.asOf === '2026-06-01')
    expect(paidOff?.liabilitiesCents).toBe(0)
    expect(Object.is(paidOff?.owedCents, 0)).toBe(true)

    expect(chart.netDomain.ticks).toContain(0)
    expect(chart.netDomain.minCents).toBeLessThanOrEqual(Math.min(...chart.points.map(point => point.liabilitiesCents)))
    expect(chart.netDomain.maxCents).toBeGreaterThanOrEqual(Math.max(...chart.points.map(point => point.assetsCents)))
    expect(chart.splitDomain.minCents).toBe(0)
  })

  it('keeps the stale stretch at its carried value, never a dip', () => {
    const rows = eighteenMonths().map(row =>
      row.staleAccountCount > 0 ? { ...row, assetsCents: 8_700_000, netCents: 8_700_000 + row.liabilitiesCents } : row
    )
    const chart = netWorthChart(rows, { range: '1Y', today })
    expect(netWorthChart(rows, { range: '6M', today }).points[0]?.asOf).toBe('2026-03-14')
    const stale = chart.points.filter(point => point.stale)
    expect(stale).toHaveLength(20)
    expect(new Set(stale.map(point => point.assetsCents))).toEqual(new Set([8_700_000]))
    expect(stale.every(point => point.netCents > 0)).toBe(true)
  })

  it('rolls all time up by week, keeps a stale week flagged, and marks typed-in history', () => {
    const rows: NetWorthSnapshot[] = [
      {
        asOf: '2024-12-31',
        source: 'manual',
        assetsCents: 7_000_000,
        liabilitiesCents: -2_000_000,
        netCents: 5_000_000,
        accountCount: 0,
        staleAccountCount: 0,
      },
      ...eighteenMonths(),
    ]
    const chart = netWorthChart(rows, { range: 'ALL', today })
    expect(chart.granularity).toBe('week')
    expect(chart.historyStartsOn).toBe('2024-12-31')
    expect(chart.trackingStartedOn).toBe('2025-03-15')
    expect(chart.points[0]).toMatchObject({ asOf: '2024-12-31', manual: true })
    expect(chart.points.filter(point => point.manual)).toHaveLength(1)
    expect(chart.points.filter(point => point.stale).map(point => point.asOf)).toEqual([
      '2026-02-01',
      '2026-02-08',
      '2026-02-15',
      '2026-02-22',
    ])
    expect(chart.points.at(-1)?.asOf).toBe(today)
  })
})

describe('axis helpers', () => {
  it('picks round ticks that cover the values', () => {
    expect(niceDomain(-250_000, 1_230_000)).toEqual({
      minCents: -500_000,
      maxCents: 1_500_000,
      ticks: [-500_000, 0, 500_000, 1_000_000, 1_500_000],
    })
    expect(niceDomain(0, 0)).toEqual({ minCents: 0, maxCents: 100, ticks: [0, 100] })
  })

  it('puts month ticks on month starts inside the range', () => {
    expect(monthTicks('2026-01-15', '2026-03-20')).toEqual(['2026-02-01', '2026-03-01'])
    expect(monthTicks('2026-01-01', '2026-01-31')).toEqual(['2026-01-01'])
  })
})

describe('manual accounts', () => {
  it('derives whether an account is owed from its kind', () => {
    expect(validateManualAccount({ name: ' Car  loan ', kind: 'loan', notes: ' ', reminderCadenceMonths: 12 })).toEqual({
      name: 'Car loan',
      kind: 'loan',
      notes: null,
      reminderCadenceMonths: 12,
      isLiability: true,
    })
    expect(validateManualAccount({ name: 'House', kind: 'property', notes: null, reminderCadenceMonths: null }).isLiability).toBe(false)
  })

  it('rejects reminder cadences outside 1 to 24 whole months', () => {
    for (const cadence of [0, 25, 1.5]) {
      expect(
        fieldErrors(() => validateManualAccount({ name: 'House', kind: 'property', notes: null, reminderCadenceMonths: cadence }))
      ).toHaveProperty('reminderCadenceMonths')
    }
  })

  it('takes a value dated today or earlier, zero or more', () => {
    const value = { asOf: '2026-09-14', valueCents: 0, source: 'estimate' as const, notes: null }
    expect(validateManualValue(value, '2026-09-14')).toEqual(value)
    expect(fieldErrors(() => validateManualValue({ ...value, asOf: '2026-09-15' }, '2026-09-14'))).toHaveProperty('asOf')
    expect(fieldErrors(() => validateManualValue({ ...value, valueCents: -1 }, '2026-09-14'))).toHaveProperty('valueCents')
    expect(fieldErrors(() => validateManualValue({ ...value, valueCents: 1.5 }, '2026-09-14'))).toHaveProperty('valueCents')
  })

  it('reminds about values older than their cadence, oldest first', () => {
    const base = { kind: 'property' as const, archived: false }
    const reminders = manualValueReminders(
      [
        { ...base, id: 'home', name: 'Home', reminderCadenceMonths: 6, latestValueOn: '2026-03-01' },
        { ...base, id: 'car', name: 'Car', kind: 'vehicle', reminderCadenceMonths: 12, latestValueOn: '2025-12-01' },
        { ...base, id: '401k', name: 'Old 401k', kind: 'retirement', reminderCadenceMonths: null, latestValueOn: '2020-01-01' },
        { ...base, id: 'cabin', name: 'Cabin', reminderCadenceMonths: 1, latestValueOn: '2020-01-01', archived: true },
        { ...base, id: 'boat', name: 'Boat', kind: 'other_asset', reminderCadenceMonths: 3, latestValueOn: '2025-01-10' },
      ],
      '2026-09-14'
    )
    expect(reminders).toEqual([
      { accountId: 'boat', name: 'Boat', kind: 'other_asset', latestValueOn: '2025-01-10', ageMonths: 20 },
      { accountId: 'home', name: 'Home', kind: 'property', latestValueOn: '2026-03-01', ageMonths: 6 },
    ])
  })

  it('counts whole months only once the day comes around', () => {
    expect(wholeMonthsBetween('2026-03-15', '2026-09-14')).toBe(5)
    expect(wholeMonthsBetween('2026-03-15', '2026-09-15')).toBe(6)
    expect(wholeMonthsBetween('2026-01-31', '2026-02-28')).toBe(1)
    expect(wholeMonthsBetween('2026-09-14', '2026-09-01')).toBe(0)
  })
})

describe('validateHistoricalSnapshot', () => {
  it('signs what was owed and only accepts days before tracking started', () => {
    const context = { today: '2026-09-14', trackingStartedOn: '2025-03-15' }
    expect(validateHistoricalSnapshot({ asOf: '2025-03-14', assetsCents: 500_000, owedCents: 200_000 }, context)).toEqual({
      asOf: '2025-03-14',
      assetsCents: 500_000,
      liabilitiesCents: -200_000,
      netCents: 300_000,
    })
    expect(fieldErrors(() => validateHistoricalSnapshot({ asOf: '2025-03-15', assetsCents: 1, owedCents: 0 }, context))).toHaveProperty(
      'asOf'
    )
    expect(Object.is(validateHistoricalSnapshot({ asOf: '2024-01-01', assetsCents: 1, owedCents: 0 }, context).liabilitiesCents, 0)).toBe(
      true
    )
    expect(fieldErrors(() => validateHistoricalSnapshot({ asOf: '2024-01-01', assetsCents: -1, owedCents: 0 }, context))).toHaveProperty(
      'assetsCents'
    )
  })

  it('accepts any past day before tracking is on', () => {
    const context = { today: '2026-09-14', trackingStartedOn: null }
    expect(validateHistoricalSnapshot({ asOf: '2026-09-13', assetsCents: 1, owedCents: 1 }, context).netCents).toBe(0)
    expect(fieldErrors(() => validateHistoricalSnapshot({ asOf: '2026-09-14', assetsCents: 1, owedCents: 1 }, context))).toHaveProperty(
      'asOf'
    )
  })
})

describe('lists', () => {
  it('groups accounts by side with each one’s share of its group', () => {
    const base = { isStale: false, updatedOn: null, institutionName: null, mask: null }
    const groups = groupNetWorthAccounts([
      { ...base, id: 'checking', name: 'Checking', source: 'plaid', type: 'depository', balanceCents: 300_000 },
      { ...base, id: 'card', name: 'Card', source: 'plaid', type: 'credit', balanceCents: -200_000 },
      { ...base, id: 'house', name: 'House', source: 'manual', type: 'property', balanceCents: 49_700_000 },
      { ...base, id: 'mortgage', name: 'Mortgage', source: 'plaid', type: 'loan', balanceCents: -800_000 },
    ])
    expect(groups.assets.totalCents).toBe(50_000_000)
    expect(groups.assets.accounts.map(account => [account.id, account.share])).toEqual([
      ['house', 0.994],
      ['checking', 0.006],
    ])
    expect(groups.liabilities.totalCents).toBe(-1_000_000)
    expect(groups.liabilities.accounts.map(account => [account.id, account.share])).toEqual([
      ['mortgage', 0.8],
      ['card', 0.2],
    ])
  })

  it('orders debts by APR, highest first, with unknown APRs last', () => {
    const base = { minimumPaymentCents: null, nextPaymentDueOn: null, isOverdue: false }
    const sorted = sortDebts([
      { ...base, accountId: 'card', name: 'Card', kind: 'credit', balanceCents: -300_000, aprPercent: 24.99 },
      { ...base, accountId: 'mortgage', name: 'Mortgage', kind: 'mortgage', balanceCents: -40_000_000, aprPercent: 6.5 },
      { ...base, accountId: 'student', name: 'Student loan', kind: 'student', balanceCents: -1_000_000, aprPercent: null },
      { ...base, accountId: 'card2', name: 'Store card', kind: 'credit', balanceCents: -500_000, aprPercent: 24.99 },
    ])
    expect(sorted.map(debt => debt.accountId)).toEqual(['card2', 'card', 'mortgage', 'student'])
  })

  it('lists debt payments soonest first and leaves out debts with no due date', () => {
    const payments = upcomingDebtPayments([
      { id: 'mortgage', name: 'Mortgage', nextPaymentDueOn: '2026-10-01' as CalendarDate },
      { id: 'manual', name: 'Loan from family', nextPaymentDueOn: null },
      { id: 'card', name: 'Card', nextPaymentDueOn: '2026-09-20' as CalendarDate },
      { id: 'auto', name: 'Auto loan', nextPaymentDueOn: '2026-09-20' as CalendarDate },
    ])
    expect(payments.map(payment => payment.id)).toEqual(['auto', 'card', 'mortgage'])
  })

  it('names Plaid account types and manual kinds, and anything unknown as other', () => {
    expect(balanceTypeLabel('depository')).toBe('Bank account')
    expect(balanceTypeLabel('brokerage')).toBe('Investments')
    expect(balanceTypeLabel('credit')).toBe('Credit card')
    expect(balanceTypeLabel('property')).toBe('Property')
    expect(balanceTypeLabel('other_liability')).toBe('Something else you owe')
    expect(balanceTypeLabel('toString')).toBe('Other')
    expect(balanceTypeLabel('annuity')).toBe('Other')
  })
})

describe('cashAndCards', () => {
  it('adds up the everyday accounts and what the cards owe, and leaves the rest out', () => {
    expect(
      cashAndCards([
        { type: 'depository', currentBalanceCents: 412_300, isHidden: false },
        { type: 'depository', currentBalanceCents: 1_000_000, isHidden: false },
        { type: 'credit', currentBalanceCents: 89_400, isHidden: false },
        { type: 'investment', currentBalanceCents: 5_000_000, isHidden: false },
        { type: 'loan', currentBalanceCents: 22_000_000, isHidden: false },
      ])
    ).toEqual({ cashCents: 1_412_300, cardsCents: 89_400 })
  })

  it('skips a hidden account and one whose balance never arrived', () => {
    expect(
      cashAndCards([
        { type: 'depository', currentBalanceCents: 500_00, isHidden: true },
        { type: 'credit', currentBalanceCents: null, isHidden: false },
      ])
    ).toEqual({ cashCents: 0, cardsCents: 0 })
  })
})
