import type { BankAccount } from '@ghar/core/banking'
import { addCalendarDays, addCalendarMonths, type CalendarDate } from '@ghar/core/dates'
import {
  planLinkedAccountSnapshot,
  planManualAccountSnapshot,
  summarizeReadings,
  type ManualValueFields,
  type NetWorthSnapshot,
  type SnapshotReading,
} from '@ghar/core/finances'

// Eighteen made-up months of one household's money, for the seed and the styleguide. It plays out
// the way the daily job would have seen it: a bank whose login lapsed for five weeks, a car loan
// paid down to nothing, and a home estimate every few months. Pure and deterministic, so a given day
// always draws the same chart, and the seed and the styleguide show the same series.

export const DEMO_HISTORY_MONTHS = 18
/** How long the bank's login stayed lapsed. */
export const DEMO_OUTAGE_DAYS = 38
/** How many days before today it lapsed: inside both the one-year and all-time ranges. */
const OUTAGE_STARTED_DAYS_AGO = 200

type DemoAccount = Omit<BankAccount, 'currentBalanceCents' | 'availableBalanceCents'>

export interface DemoBankItem {
  plaidItemId: string
  institutionName: string
  accounts: readonly DemoAccount[]
}

function account(plaidAccountId: string, name: string, mask: string, type: string, subtype: string): DemoAccount {
  return { plaidAccountId, name, officialName: null, mask, type, subtype, isoCurrency: 'USD' }
}

/** The bank whose login lapses: everyday money and the brokerage account. */
const BANK: DemoBankItem = {
  plaidItemId: 'demo-networth-harbor',
  institutionName: 'Harbor Bank',
  accounts: [
    account('demo-harbor-checking', 'Joint checking', '0917', 'depository', 'checking'),
    account('demo-harbor-savings', 'Rainy day savings', '2284', 'depository', 'savings'),
    account('demo-harbor-card', 'Rewards card', '4421', 'credit', 'credit card'),
    account('demo-harbor-brokerage', 'Brokerage', '7730', 'investment', 'brokerage'),
  ],
}

export const DEMO_CAR_LOAN_ACCOUNT_ID = 'demo-keystone-car-loan'

/** The lender, connected throughout. */
const LENDER: DemoBankItem = {
  plaidItemId: 'demo-networth-keystone',
  institutionName: 'Keystone Lending',
  accounts: [account(DEMO_CAR_LOAN_ACCOUNT_ID, 'Car loan', '5512', 'loan', 'auto'), account('demo-keystone-mortgage', 'Mortgage', '3009', 'loan', 'mortgage')],
}

export const DEMO_BANK_ITEMS: readonly DemoBankItem[] = [BANK, LENDER]

export const DEMO_HOUSE = { name: 'House', kind: 'property', notes: null, reminderCadenceMonths: 6, isLiability: false } as const

const HOUSE_ESTIMATES: [monthsIn: number, valueCents: number][] = [
  [0, 58_500_000],
  [5, 59_600_000],
  [11, 60_450_000],
]

/** An estimate when the history starts, five months in and eleven months in, so the newest is seven months old. */
export function demoHouseValues(today: CalendarDate): ManualValueFields[] {
  const startOn = addCalendarMonths(today, -DEMO_HISTORY_MONTHS)
  return HOUSE_ESTIMATES.map(([monthsIn, valueCents]) => ({
    asOf: addCalendarMonths(startOn, monthsIn),
    valueCents,
    source: 'estimate' as const,
    notes: null,
  }))
}

export interface DemoDay {
  asOf: CalendarDate
  /** When that day's sync and snapshot ran: noon UTC, a day apart. */
  now: Date
  /** What each bank reported that day, or null while its login was lapsed. */
  reports: { plaidItemId: string; accounts: BankAccount[] | null }[]
}

/** Every day from eighteen months ago through today, with what the banks reported. */
export function demoNetWorthDays(today: CalendarDate): DemoDay[] {
  const startOn = addCalendarMonths(today, -DEMO_HISTORY_MONTHS)
  const lapsedFrom = addCalendarDays(today, -OUTAGE_STARTED_DAYS_AGO)
  const reconnectedOn = addCalendarDays(lapsedFrom, DEMO_OUTAGE_DAYS)
  const random = seededRandom(0x6ba2)
  let brokerage = 6_000_000
  let carLoan = 980_000
  let mortgage = 41_200_000

  const days: DemoDay[] = []
  for (let asOf = startOn, index = 0; asOf <= today; asOf = addCalendarDays(asOf, 1), index += 1) {
    const now = new Date(`${asOf}T12:00:00Z`)
    const dayOfMonth = Number(asOf.slice(8, 10))
    const weekday = now.getUTCDay()
    // The market moves on weekdays. The contribution and the mortgage payment land on the 1st, the
    // car payment on the 5th, until the loan is paid off and its balance stays at zero.
    if (weekday !== 0 && weekday !== 6) brokerage = Math.round(brokerage * (1.0005 + (random() - 0.5) * 0.018))
    if (index > 0 && dayOfMonth === 1) {
      brokerage += 50_000
      mortgage -= 62_000
    }
    if (index > 0 && dayOfMonth === 5) carLoan = Math.max(carLoan - 70_000, 0)
    // Paid on the 1st and the 16th and spent down in between; the card builds to its statement.
    const sincePayday = (Math.min(dayOfMonth, 30) - 1) % 15
    const checking = 760_000 + Math.round(((15 - sincePayday) / 15) * 520_000 + (random() - 0.5) * 60_000)
    const savings = 1_800_000 + index * 900
    const card = 140_000 + Math.round(((dayOfMonth - 1) / 30) * 170_000 + random() * 20_000)

    const lapsed = asOf >= lapsedFrom && asOf < reconnectedOn
    days.push({
      asOf,
      now,
      reports: [
        { plaidItemId: BANK.plaidItemId, accounts: lapsed ? null : reported(BANK, [checking, savings, card, brokerage]) },
        { plaidItemId: LENDER.plaidItemId, accounts: reported(LENDER, [carLoan, mortgage]) },
      ],
    })
  }
  return days
}

/**
 * The snapshots the daily job takes from those days, worked out without a database: the same core
 * planning the job does, with each account keeping the last balance its bank sent. The seed's test
 * checks the database ends up with exactly these.
 */
export function demoNetWorthSnapshots(today: CalendarDate): NetWorthSnapshot[] {
  const houseValues = demoHouseValues(today)
  const accounts = new Map<string, { plaidItemId: string; type: string; currentBalanceCents: number | null; balanceUpdatedAt: Date }>()
  const lapsed = new Set<string>()

  return demoNetWorthDays(today).map(day => {
    for (const report of day.reports) {
      if (report.accounts === null) {
        lapsed.add(report.plaidItemId)
        continue
      }
      lapsed.delete(report.plaidItemId)
      for (const bankAccount of report.accounts) {
        accounts.set(bankAccount.plaidAccountId, {
          plaidItemId: report.plaidItemId,
          type: bankAccount.type,
          currentBalanceCents: bankAccount.currentBalanceCents,
          balanceUpdatedAt: day.now,
        })
      }
    }

    const readings: SnapshotReading[] = []
    for (const row of accounts.values()) {
      const itemStatus = lapsed.has(row.plaidItemId) ? 'login_required' : 'good'
      const planned = planLinkedAccountSnapshot({ ...row, itemStatus, previousBalanceCents: null }, day.now)
      if (planned) readings.push(planned)
    }
    const house = houseValues.findLast(value => value.asOf <= day.asOf)
    const planned = planManualAccountSnapshot({ kind: DEMO_HOUSE.kind, latestValueCents: house?.valueCents ?? null })
    if (planned) readings.push(planned)
    return { asOf: day.asOf, source: 'automatic' as const, ...summarizeReadings(readings) }
  })
}

function reported(item: DemoBankItem, balances: readonly number[]): BankAccount[] {
  return item.accounts.map((demo, index) => {
    const cents = balances[index] ?? 0
    return { ...demo, currentBalanceCents: cents, availableBalanceCents: demo.type === 'depository' ? cents : null }
  })
}

/** mulberry32: a small seeded generator, so the made-up market moves the same way every run. */
function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}
