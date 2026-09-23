import type { PGlite } from '@electric-sql/pglite'
import { addCalendarMonths, daysBetween, todayInTimeZone, type CalendarDate } from '@ghar/core/dates'
import { netWorthChart, type NetWorthSnapshot } from '@ghar/core/finances'
import { createHousehold, createManualAccount, listNetWorthSnapshots, type Db, type RequestContext } from '@ghar/db/queries'
import { beforeAll, describe, expect, it } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import {
  DEMO_CAR_LOAN_ACCOUNT_ID,
  DEMO_HISTORY_MONTHS,
  DEMO_OUTAGE_DAYS,
  demoNetWorthDays,
  demoNetWorthSnapshots,
} from '@/lib/networth/demo-history'
import { ensureNetWorthHistory } from '@/scripts/seed-networth'

// The seed's net worth history written for real against PGlite: eighteen months of balance syncs and
// snapshot runs, checked against the series the styleguide draws from the same generator.

const TIME_ZONE = 'America/New_York'
const TODAY = todayInTimeZone(TIME_ZONE)
const seal = (token: string) => `sealed.${token}`

let client: PGlite
let db: Db
let owner: RequestContext
let snapshots: NetWorthSnapshot[]

async function household(name: string): Promise<RequestContext> {
  const email = `${name}@example.com`
  const userId = await createAuthUser(client, email)
  const { household: created } = await createHousehold({ userId, email }, db, { name, timezone: TIME_ZONE, currency: 'USD' })
  return { userId, householdId: created.id, role: 'owner' }
}

async function counts(householdId: string): Promise<{ items: number; values: number }> {
  const { rows } = await client.query<{ items: number; values: number }>(
    `select (select count(*)::int from plaid_items where household_id = $1) as items,
            (select count(*)::int from manual_values v join manual_accounts m on m.id = v.manual_account_id where m.household_id = $1) as "values"`,
    [householdId]
  )
  return rows[0] ?? { items: -1, values: -1 }
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  owner = await household('demo')
  expect(await ensureNetWorthHistory(db, owner, { today: TODAY, sealToken: seal })).toEqual({
    written: true,
    days: demoNetWorthDays(TODAY).length,
  })
  snapshots = await listNetWorthSnapshots(owner, db)
}, 600_000)

describe('the demo net worth history', () => {
  it('writes eighteen months through the snapshot job, the same series the styleguide draws', () => {
    expect(snapshots[0]?.asOf).toBe(addCalendarMonths(TODAY, -DEMO_HISTORY_MONTHS))
    expect(snapshots.at(-1)?.asOf).toBe(TODAY)
    expect(snapshots.length).toBeGreaterThan(540)
    expect(snapshots).toEqual(demoNetWorthSnapshots(TODAY))
  })

  it('carries the lapsed bank forward flat and flagged, never as a drop', () => {
    const start = snapshots.findIndex(row => row.staleAccountCount > 0)
    const stretch = snapshots.slice(start, start + DEMO_OUTAGE_DAYS)
    const before = snapshots[start - 1]
    if (!before) throw new Error('expected a measured day before the lapse')
    expect(snapshots.filter(row => row.staleAccountCount > 0)).toEqual(stretch)
    expect(snapshots[start + DEMO_OUTAGE_DAYS]?.staleAccountCount).toBe(0)

    // The bank's four accounts carried, the lender's two and the house still counted: none skipped, none zeroed.
    expect(stretch.every(row => row.staleAccountCount === 4 && row.accountCount === 7)).toBe(true)
    // Everything owned is at the bank or is the house, so it holds exactly. Only the lender's payments move the line, and only up.
    expect(stretch.every(row => row.assetsCents === before.assetsCents)).toBe(true)
    let previous = before.netCents
    for (const row of stretch) {
      expect(row.netCents).toBeGreaterThanOrEqual(previous)
      previous = row.netCents
    }

    const year = netWorthChart(snapshots, { range: '1Y', today: TODAY })
    expect(year.staleRanges).toEqual([{ fromOn: stretch[0]?.asOf, toOn: stretch.at(-1)?.asOf }])
    const all = netWorthChart(snapshots, { range: 'ALL', today: TODAY })
    expect(all).toMatchObject({ status: 'ready', granularity: 'week' })
    expect(all.staleRanges).toHaveLength(1)
  })

  it('keeps the paid-off car loan at a real zero, measured every day since', async () => {
    const { rows } = await client.query<{ as_of: CalendarDate; balance: number; is_stale: boolean }>(
      `select s.as_of::text as as_of, s.balance_cents::int as balance, s.is_stale
       from account_snapshots s join accounts a on a.id = s.account_id
       where a.plaid_account_id = $1 and s.household_id = $2
       order by s.as_of`,
      [DEMO_CAR_LOAN_ACCOUNT_ID, owner.householdId]
    )
    const paidOff = rows.findIndex(row => row.balance === 0)
    expect(rows).toHaveLength(snapshots.length)
    expect(rows[0]?.balance).toBe(-980_000)
    expect(rows[paidOff - 1]?.balance).toBeLessThan(0)
    expect(rows.slice(paidOff).every(row => row.balance === 0 && !row.is_stale)).toBe(true)
    expect(daysBetween(rows[paidOff]?.as_of ?? TODAY, TODAY)).toBeGreaterThan(90)
  })

  it('leaves a household alone once it has history', async () => {
    expect(await ensureNetWorthHistory(db, owner, { today: TODAY, sealToken: seal })).toMatchObject({ written: false })
    expect(await listNetWorthSnapshots(owner, db)).toHaveLength(snapshots.length)
    expect(await counts(owner.householdId)).toEqual({ items: 2, values: 3 })
  })

  it('never replays past days over accounts a household already has', async () => {
    const other = await household('real')
    await createManualAccount(
      other,
      db,
      { name: 'Condo', kind: 'property', notes: null, reminderCadenceMonths: null, isLiability: false },
      { asOf: TODAY, valueCents: 30_000_000, source: 'manual', notes: null }
    )
    expect(await ensureNetWorthHistory(db, other, { today: TODAY, sealToken: seal })).toMatchObject({ written: false })
    expect(await listNetWorthSnapshots(other, db)).toEqual([])
    expect(await counts(other.householdId)).toEqual({ items: 0, values: 1 })
  })
})
