import 'server-only'
import { bankItemStatusForError, shouldSyncBankItem, type BankEnvironment } from '@ghar/core/banking'
import { ConflictError, NotFoundError } from '@ghar/core/errors'
import * as queries from '@ghar/db/queries'
import { INVESTMENT_ACCOUNT_TYPES, type BankItemRow, type BankItemSyncTarget, type Db, type SystemContext } from '@ghar/db/queries'
import { DecryptionError } from '@/lib/crypto'
import { PlaidItemError, PlaidProductUnavailableError, PlaidProviderError, type PlaidClient } from '@/lib/providers/plaid'

// The daily refresh of every bank connection, in four jobs that run before the net worth snapshot:
// transactions for every connection, then balances for every connection, then liability details for
// connections with a card or loan, then holdings for connections with an investment account. Each is
// its own job so one Plaid product failing never costs the others, and the snapshot still reads
// whatever balances did arrive. Transactions go first because a new connection's accounts arrive with
// them, so the jobs after it have something to work with on day one.
//
// What a failure means is decided here. Plaid saying the connection needs attention is stored on the
// connection, and a login problem stops further syncs until someone reconnects. A connection without
// a product (no investment account, or no consent to share one) is left as it is. Plaid being down or
// slow changes nothing: the next run retries, and the snapshot flags balances that grow too old.

/** Stored when a connection's access token can't be opened, usually after a bad key rotation. */
export const ACCESS_TOKEN_UNREADABLE = 'ACCESS_TOKEN_UNREADABLE'

export interface BankRefreshDeps {
  db: Db
  /**
   * The client for connections made in a Plaid environment, or null when this deployment can't sync
   * them. Asked once per environment, and only when a connection needs it.
   */
  client: (environment: BankEnvironment) => PlaidClient | null
  /** Opens a stored access token. */
  decrypt: (sealed: string) => string
  now: () => Date
}

export type BankRefreshResult = {
  /** Connections this job applies to. */
  items: number
  synced: number
  /** Waiting for a reconnect, gone, or from a Plaid environment this deployment doesn't sync. */
  skipped: number
  /** Plaid has nothing of this kind for the connection. Not an error. */
  unavailable: number
  /** Connections this run found needing a reconnect. */
  loginRequired: number
  errors: number
}

type Outcome = 'synced' | 'skipped' | 'unavailable' | 'loginRequired' | 'errors'

interface ItemRefresh {
  db: Db
  now: Date
  client: PlaidClient
  accessToken: string
  actor: SystemContext
  itemId: string
  /** The connection's /transactions/sync cursor. Null before its first transaction sync. */
  cursor: string | null
}

interface Refresh {
  /** For logs. */
  product: 'balance' | 'liabilities' | 'investments' | 'transactions'
  appliesTo: (target: BankItemSyncTarget) => boolean
  apply: (refresh: ItemRefresh) => Promise<void>
}

const OWED_ACCOUNT_TYPES = new Set(['credit', 'loan'])
const INVESTMENT_TYPES = new Set<string>(INVESTMENT_ACCOUNT_TYPES)

/** Balances from /accounts/get for every connection. Free: Plaid returns what it last fetched. */
export function runBalanceSync(deps: BankRefreshDeps): Promise<BankRefreshResult> {
  return refreshItems(deps, {
    product: 'balance',
    appliesTo: () => true,
    async apply({ db, now, client, accessToken, actor, itemId }) {
      const accounts = await client.getAccounts(accessToken)
      await queries.applyBalanceSync(actor, db, { itemId, accounts, now })
    },
  })
}

/**
 * /liabilities/get for connections holding a card or loan. The account types come from earlier
 * syncs, so a connection no sync has listed accounts for yet waits for the balance job.
 */
export function runLiabilitiesSync(deps: BankRefreshDeps): Promise<BankRefreshResult> {
  return refreshItems(deps, {
    product: 'liabilities',
    appliesTo: target => target.accountTypes.some(type => OWED_ACCOUNT_TYPES.has(type)),
    async apply({ db, now, client, accessToken, actor, itemId }) {
      const result = await client.getLiabilities(accessToken)
      await queries.applyLiabilitiesSync(actor, db, { itemId, ...result, now })
    },
  })
}

/** /investments/holdings/get for connections holding an investment account. */
export function runInvestmentsSync(deps: BankRefreshDeps): Promise<BankRefreshResult> {
  return refreshItems(deps, {
    product: 'investments',
    appliesTo: target => target.accountTypes.some(type => INVESTMENT_TYPES.has(type)),
    async apply({ db, now, client, accessToken, actor, itemId }) {
      // Holdings are stored for composition only. The account's value stays the balance Plaid reports.
      const result = await client.getHoldings(accessToken)
      await queries.applyInvestmentsSync(actor, db, { itemId, ...result, now })
    },
  })
}

/**
 * What a transaction sync moved, on top of how its connections fared. A type rather than an
 * interface, so a job's result still satisfies the cron's Record<string, unknown> metadata.
 */
export type TransactionSyncTotals = {
  inserted: number
  updated: number
  deleted: number
}

/**
 * Rounds of /transactions/sync one connection gets per run. Each round is up to the provider's page
 * cap, and the cursor advances as each lands, so a connection with more history than this finishes
 * on the next run rather than holding the job open.
 */
const MAX_SYNC_ROUNDS = 5

function transactionRefresh(totals: TransactionSyncTotals): Refresh {
  return {
    product: 'transactions',
    appliesTo: () => true,
    async apply({ db, now, client, accessToken, actor, itemId, cursor }) {
      let expectedCursor = cursor
      for (let round = 0; round < MAX_SYNC_ROUNDS; round += 1) {
        const { accounts, pages, nextCursor, hasMore } = await client.syncTransactions(accessToken, expectedCursor)
        // Accounts ride along with the changes, so a brand new connection gets both at once.
        const result = await queries.applyTransactionSync(actor, db, { itemId, expectedCursor, nextCursor, accounts, pages, now })
        totals.inserted += result.inserted
        totals.updated += result.updated
        totals.deleted += result.deleted
        if (!hasMore) return
        expectedCursor = nextCursor
      }
    },
  }
}

/**
 * /transactions/sync for every connection. New transactions arrive here, and so do the accounts
 * they belong to, which is why this runs before the balance job on a connection's first day.
 */
export async function runTransactionsSync(deps: BankRefreshDeps): Promise<BankRefreshResult & TransactionSyncTotals> {
  const totals: TransactionSyncTotals = { inserted: 0, updated: 0, deleted: 0 }
  const result = await refreshItems(deps, transactionRefresh(totals))
  return { ...result, ...totals }
}

/**
 * The same sync for one connection, for when somebody has just linked it or Plaid says it has
 * changes. Failures are recorded on the connection exactly as the daily job records them.
 */
export async function syncItemTransactions(deps: BankRefreshDeps, item: BankItemRow): Promise<BankRefreshResult & TransactionSyncTotals> {
  const totals: TransactionSyncTotals = { inserted: 0, updated: 0, deleted: 0 }
  const result = await refreshOne(deps, transactionRefresh(totals), { ...item, accountTypes: [] })
  return { ...result, ...totals }
}

async function refreshOne(deps: BankRefreshDeps, refresh: Refresh, target: BankItemSyncTarget): Promise<BankRefreshResult> {
  const result: BankRefreshResult = { items: 1, synced: 0, skipped: 0, unavailable: 0, loginRequired: 0, errors: 0 }
  let outcome: Outcome
  try {
    outcome = await refreshItem(deps, refresh, target, deps.client(target.environment))
  } catch (error) {
    console.error(`Bank ${refresh.product} sync for connection ${target.id} failed`, error)
    outcome = 'errors'
  }
  result[outcome] += 1
  return result
}

async function refreshItems(deps: BankRefreshDeps, refresh: Refresh): Promise<BankRefreshResult> {
  const targets = (await queries.listBankItemsForSync(deps.db)).filter(refresh.appliesTo)
  const result: BankRefreshResult = { items: targets.length, synced: 0, skipped: 0, unavailable: 0, loginRequired: 0, errors: 0 }

  // Resolved up front, so production without Plaid keys fails the job loudly instead of every
  // connection quietly.
  const clients = new Map<BankEnvironment, PlaidClient | null>()
  for (const target of targets) {
    if (!clients.has(target.environment)) clients.set(target.environment, deps.client(target.environment))
  }

  for (const target of targets) {
    let outcome: Outcome
    try {
      outcome = await refreshItem(deps, refresh, target, clients.get(target.environment) ?? null)
    } catch (error) {
      console.error(`Bank ${refresh.product} sync for connection ${target.id} failed`, error)
      outcome = 'errors'
    }
    result[outcome] += 1
  }
  return result
}

async function refreshItem(
  deps: BankRefreshDeps,
  refresh: Refresh,
  target: BankItemSyncTarget,
  client: PlaidClient | null
): Promise<Outcome> {
  if (client === null || !shouldSyncBankItem(target)) return 'skipped'
  // Nobody is signed in during the cron run; the connection's own household scopes every query.
  const actor: SystemContext = { householdId: target.householdId, userId: null }

  let credentials
  try {
    credentials = await queries.getBankItemCredentials(actor, deps.db, { itemId: target.id })
  } catch (error) {
    // Deleted, or turned off, since the list was read. A turned-off connection has no token left.
    if (error instanceof NotFoundError || error instanceof ConflictError) return 'skipped'
    throw error
  }
  const { item } = credentials

  try {
    const accessToken = deps.decrypt(credentials.accessTokenEncrypted)
    await refresh.apply({ db: deps.db, now: deps.now(), client, accessToken, actor, itemId: item.id, cursor: credentials.cursor })
    return 'synced'
  } catch (error) {
    if (error instanceof PlaidProductUnavailableError) return 'unavailable'

    if (error instanceof PlaidItemError) {
      const status = bankItemStatusForError(error.code)
      console.warn(`Bank ${refresh.product} sync for connection ${item.id}: ${error.message}`)
      await queries.setBankItemState(actor, deps.db, {
        itemId: item.id,
        state: { status, errorCode: error.code, consentExpiresAt: item.consentExpiresAt },
        change: 'sync_failed',
      })
      return status === 'login_required' ? 'loginRequired' : 'errors'
    }

    if (error instanceof DecryptionError) {
      console.error(`Bank ${refresh.product} sync for connection ${item.id} couldn’t open the access token`)
      await queries.setBankItemState(actor, deps.db, {
        itemId: item.id,
        state: { status: 'error', errorCode: ACCESS_TOKEN_UNREADABLE, consentExpiresAt: item.consentExpiresAt },
        change: 'sync_failed',
      })
      return 'errors'
    }

    // Provider errors carry our own wording. Anything else is logged whole.
    if (error instanceof PlaidProviderError) {
      console.warn(`Bank ${refresh.product} sync for connection ${item.id} failed: ${error.message}`)
    } else {
      console.error(`Bank ${refresh.product} sync for connection ${item.id} failed`, error)
    }
    return 'errors'
  }
}
