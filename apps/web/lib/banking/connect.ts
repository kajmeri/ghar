import 'server-only'
import { requirePermission } from '@ghar/core/auth'
import {
  assertCanCreateBankItem,
  assertCanDisconnectBankItem,
  bankItemStateForWebhook,
  canReconnectBankItem,
  type BankEnvironment,
  type BankItemState,
  type BankLinkToken,
  type BankWebhookEvent,
} from '@ghar/core/banking'
import { ConflictError } from '@ghar/core/errors'
import * as queries from '@ghar/db/queries'
import type { Actor, BankItemRow, Db, SystemContext } from '@ghar/db/queries'
import type { RequestContext } from '@/lib/auth/context'
import { DecryptionError, openSecret, sealSecret } from '@/lib/crypto'
import { getDb } from '@/lib/db'
import { env } from '@/lib/env'
import { categorizationDeps, categorizeHousehold } from '@/lib/finances/run-categorization'
import { currentBankEnvironment, getPlaidClient, type PlaidClient } from '@/lib/providers/plaid'
import { syncItemTransactions, type BankRefreshDeps, type TransactionSyncTotals } from './refresh'

// Connecting a bank, and acting on what Plaid says about a connection afterwards.
//
// Link runs in the browser: the page asks for a link token, Plaid hands back a public token, and
// this trades that for the access token it seals and stores. The access token never leaves the
// server, is never logged, and is never part of an API response.
//
// A connection's first transaction sync runs here rather than waiting for the cron, because a
// household that just linked a bank expects to see its money. Whatever the household's rules and
// Plaid's own categories can decide about the new transactions is decided in the same breath, so
// the money arrives already sorted. The model is not asked here: that waits for the nightly run,
// and nobody should hold a page open for it.

export interface BankConnectDeps extends BankRefreshDeps {
  /** Seals an access token for storage. */
  seal: (plaintext: string) => string
  /** Where Plaid should post webhooks, or null when this deployment isn't reachable from Plaid. */
  webhookUrl: string | null
  /** Where a new connection would be made. Throws in production without Plaid keys. */
  environment: () => BankEnvironment
}

export function bankConnectDeps(db: Db = getDb()): BankConnectDeps {
  return {
    db,
    client: getPlaidClient,
    decrypt: openSecret,
    seal: sealSecret,
    now: () => new Date(),
    webhookUrl: webhookUrl(),
    environment: currentBankEnvironment,
  }
}

/**
 * Plaid has to reach this URL from the internet, so a local deployment asks for no webhooks at all
 * and leans on the daily sync instead.
 */
function webhookUrl(): string | null {
  const appUrl = env().APP_URL
  return appUrl.startsWith('https://') ? `${appUrl}/api/webhooks/plaid` : null
}

function clientFor(deps: BankConnectDeps, environment: BankEnvironment): PlaidClient {
  const client = deps.client(environment)
  if (client === null) {
    throw new ConflictError('This deployment can’t reach the Plaid environment that connection was made in.')
  }
  return client
}

/**
 * A token for opening Link. With an `itemId` it reopens that connection to repair it, which keeps
 * the connection and everything already synced; without one it starts a new connection.
 *
 * Plaid stores the `client_user_id`, so it gets the household's id: stable, and nothing about a
 * person.
 */
export async function createLinkToken(
  ctx: RequestContext,
  input: { itemId?: string } = {},
  deps: BankConnectDeps = bankConnectDeps()
): Promise<BankLinkToken> {
  requirePermission(ctx, 'finances.manage')

  if (input.itemId === undefined) {
    const environment = deps.environment()
    // Refuse before Link opens, rather than after somebody has signed in to their bank.
    assertCanCreateBankItem({
      environment,
      productionItemsCreated: await queries.countBankItemsByEnvironment(deps.db, 'production'),
    })
    return clientFor(deps, environment).createLinkToken({ userRef: ctx.householdId, webhookUrl: deps.webhookUrl })
  }

  const { item, accessTokenEncrypted } = await queries.getBankItemCredentials(ctx, deps.db, { itemId: input.itemId })
  if (!canReconnectBankItem(item, deps.now())) {
    throw new ConflictError('That connection doesn’t need reconnecting.')
  }
  return clientFor(deps, item.environment).createLinkToken({
    userRef: ctx.householdId,
    webhookUrl: deps.webhookUrl,
    accessToken: deps.decrypt(accessTokenEncrypted),
  })
}

export interface BankConnectionResult {
  connection: BankItemRow
  sync: TransactionSyncTotals & { synced: boolean }
}

/**
 * The rules and Plaid's categories over whatever a sync just brought in. Its own failure is never
 * the caller's: the transactions are stored either way, and the nightly run categorizes them.
 */
async function categorizeNewTransactions(actor: Actor, deps: BankConnectDeps, moved: number): Promise<void> {
  if (moved === 0) return
  try {
    await categorizeHousehold(actor, categorizationDeps(deps.db), { askModel: false })
  } catch (error) {
    console.error(`Categorizing after a sync failed for household ${actor.householdId}`, error)
  }
}

async function syncAndRead(ctx: RequestContext, deps: BankConnectDeps, item: BankItemRow): Promise<BankConnectionResult> {
  const sync = await syncItemTransactions(deps, item)
  await categorizeNewTransactions(ctx, deps, sync.inserted + sync.updated)
  return {
    // Read again: the sync may have recorded an error or moved the last-synced time.
    connection: await queries.getBankItem(ctx, deps.db, { itemId: item.id }),
    sync: { inserted: sync.inserted, updated: sync.updated, deleted: sync.deleted, synced: sync.synced === 1 },
  }
}

/**
 * Finishes a new connection: trades the public token, seals the access token, stores the
 * connection, and syncs its transactions once. A sync that fails leaves the connection in place
 * with Plaid's reason on it, because the connection itself is good.
 */
export async function completeLink(
  ctx: RequestContext,
  input: { publicToken: string },
  deps: BankConnectDeps = bankConnectDeps()
): Promise<BankConnectionResult> {
  requirePermission(ctx, 'finances.manage')
  const environment = deps.environment()
  const client = clientFor(deps, environment)

  const { accessToken, plaidItemId } = await client.exchangePublicToken(input.publicToken)
  const institution = await client.getInstitution(accessToken)

  const connection = await queries.createBankItem(ctx, deps.db, {
    environment,
    plaidItemId,
    institutionId: institution.institutionId,
    institutionName: institution.name,
    accessTokenEncrypted: deps.seal(accessToken),
  })

  return syncAndRead(ctx, deps, connection)
}

/**
 * Finishes an update-mode Link: the sign-in is repaired, so the connection goes back to good and
 * syncs whatever it missed while it was broken.
 */
export async function completeReconnect(
  ctx: RequestContext,
  input: { itemId: string },
  deps: BankConnectDeps = bankConnectDeps()
): Promise<BankConnectionResult> {
  requirePermission(ctx, 'finances.manage')
  const item = await queries.getBankItem(ctx, deps.db, { itemId: input.itemId })
  assertStillConnected(item)
  const repaired = await queries.setBankItemState(ctx, deps.db, {
    itemId: item.id,
    state: { status: 'good', errorCode: null, consentExpiresAt: null },
    change: 'reconnected',
  })
  return syncAndRead(ctx, deps, repaired)
}

/** "Sync now" for one connection. */
export async function syncConnection(
  ctx: RequestContext,
  input: { itemId: string },
  deps: BankConnectDeps = bankConnectDeps()
): Promise<BankConnectionResult> {
  requirePermission(ctx, 'finances.manage')
  const item = await queries.getBankItem(ctx, deps.db, { itemId: input.itemId })
  assertStillConnected(item)
  return syncAndRead(ctx, deps, item)
}

/**
 * A connection that was turned off has no token and nothing to repair. Connecting the bank again
 * makes a new connection, and this one keeps what it already brought in.
 */
function assertStillConnected(item: BankItemRow): void {
  if (item.status === 'disconnected') {
    throw new ConflictError('That connection is turned off. Connect the bank again to start syncing it.')
  }
}

/**
 * Turns a connection off. The token is revoked at Plaid first, so if the bank can't be told, the
 * connection is left alone rather than left claiming to be off while it still reads the account.
 * Once it is revoked the row keeps everything the connection brought in and stops syncing.
 *
 * A token that can no longer be opened is a token nothing can use anyway, so it is dropped without
 * the trip to Plaid.
 */
export async function disconnectConnection(
  ctx: RequestContext,
  input: { itemId: string },
  deps: BankConnectDeps = bankConnectDeps()
): Promise<BankItemRow> {
  requirePermission(ctx, 'finances.manage')
  const item = await queries.getBankItem(ctx, deps.db, { itemId: input.itemId })
  assertCanDisconnectBankItem(item)

  const { accessTokenEncrypted } = await queries.getBankItemCredentials(ctx, deps.db, { itemId: item.id })
  let accessToken: string | null
  try {
    accessToken = deps.decrypt(accessTokenEncrypted)
  } catch (error) {
    if (!(error instanceof DecryptionError)) throw error
    console.warn(`Disconnecting connection ${item.id} without revoking: its access token can’t be opened`)
    accessToken = null
  }
  if (accessToken !== null) await clientFor(deps, item.environment).removeItem(accessToken)

  return queries.disconnectBankItem(ctx, deps.db, { itemId: item.id, now: deps.now() })
}

/** Deletes what a connection that is already off brought in. Asked for by name; never a side effect. */
export async function deleteConnectionHistory(
  ctx: RequestContext,
  input: { itemId: string },
  deps: BankConnectDeps = bankConnectDeps()
): Promise<{ connection: BankItemRow; removed: { accounts: number; transactions: number } }> {
  requirePermission(ctx, 'finances.manage')
  const { item, removed } = await queries.deleteBankItemHistory(ctx, deps.db, { itemId: input.itemId })
  return { connection: item, removed }
}

export type WebhookOutcome = 'synced' | 'state_changed' | 'ignored' | 'unknown_item' | 'unverified'

/**
 * Acts on a webhook Plaid sent about one connection.
 *
 * The connection is found before the signature is checked, so the check runs against the Plaid
 * environment that connection lives in. A webhook for a connection this deployment doesn't have is
 * dropped without a word: nothing here tells a sender whether an Item exists.
 */
export async function handleBankWebhook(
  event: BankWebhookEvent,
  verification: { body: string; jwt: string },
  deps: BankConnectDeps = bankConnectDeps()
): Promise<WebhookOutcome> {
  if (event.plaidItemId === null) return 'ignored'

  const item = await queries.findBankItemByPlaidItemId(deps.db, event.plaidItemId)
  if (item === null) return 'unknown_item'
  // A connection the household turned off has no token left. Plaid's last words about it change
  // nothing, and it is never synced again.
  if (item.status === 'disconnected') return 'ignored'

  const client = deps.client(item.environment)
  if (client === null) return 'unknown_item'
  if (!(await client.verifyWebhook({ body: verification.body, jwt: verification.jwt, now: deps.now() }))) {
    return 'unverified'
  }

  // Nobody is signed in for a webhook; the connection's own household scopes every query.
  const actor: SystemContext = { householdId: item.householdId, userId: null }
  const state: BankItemState = { status: item.status, errorCode: item.errorCode, consentExpiresAt: item.consentExpiresAt }

  const next = bankItemStateForWebhook(event, state, deps.now())
  if (next !== null) {
    await queries.setBankItemState(actor, deps.db, { itemId: item.id, state: next, change: 'webhook' })
    return 'state_changed'
  }

  if (event.kind === 'sync_available') {
    const sync = await syncItemTransactions(deps, item)
    await categorizeNewTransactions(actor, deps, sync.inserted + sync.updated)
    return 'synced'
  }
  return 'ignored'
}
