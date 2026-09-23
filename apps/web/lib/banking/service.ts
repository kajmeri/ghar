import 'server-only'
import type { BankConnection, BankLinkProviderValue } from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import { bankItemAttention, canReconnectBankItem, PLAID_PRODUCTION_ITEM_LIMIT, type BankItemState } from '@ghar/core/banking'
import * as queries from '@ghar/db/queries'
import type { BankItemRow } from '@ghar/db/queries'
import type { RequestContext } from '@/lib/auth/context'
import { getDb } from '@/lib/db'
import { currentBankEnvironment, usesFakePlaid } from '@/lib/providers/plaid'

// Bank connections as the API describes them. The access token, the sync cursor and Plaid's own
// item id stay in the database; what a client gets is which bank it is and what it needs.

function stateOf(item: BankItemRow): BankItemState {
  return { status: item.status, errorCode: item.errorCode, consentExpiresAt: item.consentExpiresAt }
}

const NOTHING: queries.BankItemContents = { accounts: 0, transactions: 0 }

export function toBankConnection(item: BankItemRow, now: Date, contents: queries.BankItemContents = NOTHING): BankConnection {
  const state = stateOf(item)
  return {
    id: item.id,
    institutionName: item.institutionName,
    environment: item.environment,
    status: item.status,
    attention: bankItemAttention(state, now),
    canReconnect: canReconnectBankItem(state, now),
    disconnectedAt: item.disconnectedAt?.toISOString() ?? null,
    accountCount: contents.accounts,
    transactionCount: contents.transactions,
    consentExpiresAt: item.consentExpiresAt?.toISOString() ?? null,
    lastSyncedAt: item.lastSyncedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
  }
}

/** One connection with its counts read back, for the routes that answer with a single connection. */
export async function readBankConnection(ctx: RequestContext, item: BankItemRow, now = new Date()): Promise<BankConnection> {
  return toBankConnection(item, now, await queries.getBankItemContents(ctx, getDb(), { itemId: item.id }))
}

/** Which Link the browser should open: the real one, or the stand-in used without Plaid keys. */
export function linkProvider(): BankLinkProviderValue {
  return usesFakePlaid() ? 'fake' : 'plaid'
}

export interface BankConnectionsView {
  connections: BankConnection[]
  provider: BankLinkProviderValue
  canConnect: boolean
}

export async function listConnections(ctx: RequestContext, now = new Date()): Promise<BankConnectionsView> {
  const db = getDb()
  const [items, contents] = await Promise.all([queries.listBankItems(ctx, db), queries.listBankItemContents(ctx, db)])

  return {
    connections: items.map(item => toBankConnection(item, now, contents.get(item.id))),
    provider: linkProvider(),
    canConnect: can(ctx.role, 'finances.manage') && (await hasConnectionsLeft(db)),
  }
}

/**
 * Whether another connection can be made at all. Production Items are a lifetime allowance on
 * Ghar's Plaid plan, so the button goes away before somebody signs in to a bank for nothing.
 */
async function hasConnectionsLeft(db: queries.Db): Promise<boolean> {
  let environment
  try {
    environment = currentBankEnvironment()
  } catch {
    // Production without Plaid keys: nothing can be connected until they're set.
    return false
  }
  if (environment !== 'production') return true
  return (await queries.countBankItemsByEnvironment(db, 'production')) < PLAID_PRODUCTION_ITEM_LIMIT
}
