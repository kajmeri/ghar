import type { CalendarDate } from '@ghar/core/dates'
import * as queries from '@ghar/db/queries'
import type { Db, RequestContext } from '@ghar/db/queries'
import { DEMO_BANK_ITEMS, DEMO_HOUSE, demoHouseValues, demoNetWorthDays } from '@/lib/networth/demo-history'

export type NetWorthHistorySeed = { written: true; days: number } | { written: false; reason: string }

/**
 * Writes the demo net worth history the way it would have built up: for each day of the eighteen
 * months, the balances that day's sync brought (or nothing while the bank's login was lapsed), then
 * the real snapshot job for that day. The stale stretch is the job's own carry-forward, not a row made
 * to look like one.
 *
 * All in one transaction, and only in a household with no accounts or history of its own, since
 * replaying past days would snapshot real accounts at today's balances. So running it again leaves
 * the household alone, and a failed run leaves nothing behind.
 */
export async function ensureNetWorthHistory(
  db: Db,
  ctx: RequestContext,
  input: { today: CalendarDate; sealToken: (accessToken: string) => string }
): Promise<NetWorthHistorySeed> {
  return db.transaction(async (tx): Promise<NetWorthHistorySeed> => {
    if ((await queries.listNetWorthSnapshots(ctx, tx)).length > 0) return { written: false, reason: 'it already has net worth history' }
    const items = await queries.listBankItems(ctx, tx)
    const manual = await queries.listManualAccounts(ctx, tx, { includeArchived: true })
    if (items.length > 0 || manual.length > 0) return { written: false, reason: 'it has accounts of its own' }

    const itemIds = new Map<string, string>()
    for (const demo of DEMO_BANK_ITEMS) {
      const item = await queries.createBankItem(ctx, tx, {
        environment: 'fake',
        plaidItemId: demo.plaidItemId,
        institutionId: null,
        institutionName: demo.institutionName,
        // A made-up token for a fake connection, sealed like any other.
        accessTokenEncrypted: input.sealToken(`access-${demo.plaidItemId}`),
      })
      itemIds.set(demo.plaidItemId, item.id)
    }

    const [first = null, ...later] = demoHouseValues(input.today)
    const house = await queries.createManualAccount(ctx, tx, DEMO_HOUSE, first)
    for (const value of later) await queries.addManualValue(ctx, tx, house.id, value)

    const days = demoNetWorthDays(input.today)
    const lapsed = new Set<string>()
    for (const day of days) {
      for (const report of day.reports) {
        const itemId = itemIds.get(report.plaidItemId)
        if (itemId === undefined) throw new Error(`No demo connection for ${report.plaidItemId}`)
        if (report.accounts !== null) {
          await queries.applyBalanceSync(ctx, tx, { itemId, accounts: report.accounts, now: day.now })
          lapsed.delete(itemId)
        } else if (!lapsed.has(itemId)) {
          const state = { status: 'login_required', errorCode: 'ITEM_LOGIN_REQUIRED', consentExpiresAt: null } as const
          await queries.setBankItemState(ctx, tx, { itemId, state, change: 'webhook' })
          lapsed.add(itemId)
        }
      }
      await queries.takeNetWorthSnapshot(ctx, tx, { today: day.asOf, now: day.now })
    }
    return { written: true, days: days.length }
  })
}
