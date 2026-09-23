import 'server-only'
import { todayInTimeZone } from '@ghar/core/dates'
import * as queries from '@ghar/db/queries'
import type { Db, SystemContext } from '@ghar/db/queries'

// The daily net worth snapshot, run after the bank jobs so it reads the balances they just brought
// in. Each household gets one reading per account for its own today, and one row of totals. What it
// counts, and what it carries forward as stale, is decided in takeNetWorthSnapshot and
// @ghar/core/finances. A second run the same day rewrites the same rows.

export interface NetWorthSnapshotDeps {
  db: Db
  now: Date
}

export type NetWorthSnapshotResult = {
  households: number
  taken: number
  /** Households with nothing to count yet, or whose day was typed in by hand. */
  empty: number
  accounts: number
  /** Accounts carried forward from an older balance. */
  staleAccounts: number
  errors: number
}

export async function runNetWorthSnapshots(deps: NetWorthSnapshotDeps): Promise<NetWorthSnapshotResult> {
  const result: NetWorthSnapshotResult = { households: 0, taken: 0, empty: 0, accounts: 0, staleAccounts: 0, errors: 0 }
  for (const household of await queries.listHouseholdsForNetWorth(deps.db)) {
    result.households += 1
    try {
      // The household comes from the stored row, never from a request.
      const actor: SystemContext = { householdId: household.id, userId: null }
      const run = await queries.takeNetWorthSnapshot(actor, deps.db, {
        today: todayInTimeZone(household.timezone, deps.now),
        now: deps.now,
      })
      if (run.taken) result.taken += 1
      else result.empty += 1
      result.accounts += run.accountCount
      result.staleAccounts += run.staleAccountCount
    } catch (error) {
      result.errors += 1
      console.error(`Net worth snapshot failed for household ${household.id}`, error)
    }
  }
  return result
}
