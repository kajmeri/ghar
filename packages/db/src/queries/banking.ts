import { requirePermission } from '@ghar/core/auth'
import {
  assertCanCreateBankItem,
  assertCanDisconnectBankItem,
  isTransferTransaction,
  planTransactionSync,
  transactionIdsToLoad,
  type BankAccount,
  type BankEnvironment,
  type BankHolding,
  type BankItemState,
  type BankLiability,
  type BankTransaction,
  type StoredTransaction,
  type TransactionChanges,
} from '@ghar/core/banking'
import { ConflictError, NotFoundError, ValidationError } from '@ghar/core/errors'
import type { CategorySource } from '@ghar/core/finances'
import { and, asc, count, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm'
import { accounts, categories, holdings, liabilityDetails, plaidItems, transactionEdits, transactions } from '../schema'
import { recordAudit } from './audit'
import { authorize } from './authorize'
import { keysetAfter, keysetOrder, pageKeys, toPage, type Keyset, type Page, type PageRequest } from './pagination'
import { isUniqueViolation } from './pg-errors'
import type { Actor, Db, RequestContext } from './types'

// Bank connections, accounts and transactions. People reach these with a RequestContext. A cron
// sync or a verified webhook has no person, so the sync functions also take a SystemContext
// built from the stored item. Three functions read across households and take no context:
// countBankItemsByEnvironment, listBankItemsForSync and findBankItemByPlaidItemId.

const CHUNK = 500

// ---------------------------------------------------------------------------------------------
// Connections

/** A connection as the app sees it. Never carries the access token or the sync cursor. */
export interface BankItemRow {
  id: string
  householdId: string
  environment: BankEnvironment
  plaidItemId: string
  institutionId: string | null
  institutionName: string | null
  status: BankItemState['status']
  errorCode: string | null
  consentExpiresAt: Date | null
  lastSyncedAt: Date | null
  disconnectedAt: Date | null
  createdAt: Date
}

const bankItemColumns = {
  id: plaidItems.id,
  householdId: plaidItems.householdId,
  environment: plaidItems.environment,
  plaidItemId: plaidItems.plaidItemId,
  institutionId: plaidItems.institutionId,
  institutionName: plaidItems.institutionName,
  status: plaidItems.status,
  errorCode: plaidItems.errorCode,
  consentExpiresAt: plaidItems.consentExpiresAt,
  lastSyncedAt: plaidItems.lastSyncedAt,
  disconnectedAt: plaidItems.disconnectedAt,
  createdAt: plaidItems.createdAt,
}

const ITEM_NOT_FOUND = 'That bank connection no longer exists.'
const ITEM_DISCONNECTED = 'That connection is turned off. Connect the bank again to start syncing it.'

function itemKey(actor: Actor, itemId: string) {
  return and(eq(plaidItems.id, itemId), eq(plaidItems.householdId, actor.householdId))
}

export async function listBankItems(ctx: RequestContext, db: Db): Promise<BankItemRow[]> {
  requirePermission(ctx, 'finances.view')
  return db
    .select(bankItemColumns)
    .from(plaidItems)
    .where(eq(plaidItems.householdId, ctx.householdId))
    .orderBy(asc(plaidItems.createdAt), asc(plaidItems.id))
}

export async function getBankItem(ctx: RequestContext, db: Db, input: { itemId: string }): Promise<BankItemRow> {
  requirePermission(ctx, 'finances.view')
  const [item] = await db.select(bankItemColumns).from(plaidItems).where(itemKey(ctx, input.itemId)).limit(1)
  if (!item) throw new NotFoundError(ITEM_NOT_FOUND)
  return item
}

/** What a sync or update-mode Link needs. The token is still encrypted. */
export async function getBankItemCredentials(
  actor: Actor,
  db: Db,
  input: { itemId: string }
): Promise<{ item: BankItemRow; accessTokenEncrypted: string; cursor: string | null }> {
  authorize(actor, 'finances.manage')
  const [row] = await db
    .select({
      item: bankItemColumns,
      accessTokenEncrypted: plaidItems.accessTokenEncrypted,
      cursor: plaidItems.cursor,
    })
    .from(plaidItems)
    .where(itemKey(actor, input.itemId))
    .limit(1)
  if (!row) throw new NotFoundError(ITEM_NOT_FOUND)
  const { accessTokenEncrypted } = row
  // A disconnected connection kept everything but its credential, which was revoked at Plaid.
  if (accessTokenEncrypted === null) throw new ConflictError(ITEM_DISCONNECTED)
  return { ...row, accessTokenEncrypted }
}

/**
 * Every Item ever stored in an environment, across households, including disconnected ones.
 * Production Items are a lifetime allowance, so nothing here is ever subtracted.
 */
export async function countBankItemsByEnvironment(db: Db, environment: BankEnvironment): Promise<number> {
  const [row] = await db.select({ total: count() }).from(plaidItems).where(eq(plaidItems.environment, environment))
  return row?.total ?? 0
}

/** A connection as the cron sync sees it: with the kinds of account it holds so far. */
export interface BankItemSyncTarget extends BankItemRow {
  /** Plaid account types, distinct and sorted. Empty until a sync first brings accounts in. */
  accountTypes: string[]
}

/** For the cron sync: every connection in every household, oldest first. */
export async function listBankItemsForSync(db: Db): Promise<BankItemSyncTarget[]> {
  return db
    .select({
      ...bankItemColumns,
      // Every column names its table: Drizzle leaves a single-table select list unqualified, and both
      // tables have a plaid_item_id.
      accountTypes: sql<
        string[]
      >`array(select distinct ${accounts}.${sql.identifier('type')} from ${accounts} where ${accounts}.${sql.identifier('plaid_item_id')} = ${plaidItems}.${sql.identifier('id')} order by 1)`,
    })
    .from(plaidItems)
    .orderBy(asc(plaidItems.createdAt))
}

/** For webhooks, which name Plaid's Item ID. The household comes from the row found. */
export async function findBankItemByPlaidItemId(db: Db, plaidItemId: string): Promise<BankItemRow | null> {
  const [item] = await db.select(bankItemColumns).from(plaidItems).where(eq(plaidItems.plaidItemId, plaidItemId)).limit(1)
  return item ?? null
}

// Serializes connection creation so two Links finishing at once can't both take the last slot.
const CREATE_ITEM_LOCK = sql`select pg_advisory_xact_lock(hashtext('ghar.plaid_items.create'))`

export async function createBankItem(
  ctx: RequestContext,
  db: Db,
  input: {
    environment: BankEnvironment
    plaidItemId: string
    institutionId: string | null
    institutionName: string | null
    accessTokenEncrypted: string
  }
): Promise<BankItemRow> {
  requirePermission(ctx, 'finances.manage')
  try {
    return await db.transaction(async tx => {
      await tx.execute(CREATE_ITEM_LOCK)
      assertCanCreateBankItem({
        environment: input.environment,
        productionItemsCreated: await countBankItemsByEnvironment(tx, 'production'),
      })

      const [item] = await tx
        .insert(plaidItems)
        .values({ householdId: ctx.householdId, ...input })
        .returning(bankItemColumns)
      if (!item) throw new Error('Bank connection insert returned no row')

      await recordAudit(ctx, tx, {
        action: 'bank.connected',
        entity: 'plaid_item',
        entityId: item.id,
        metadata: { institutionName: input.institutionName, environment: input.environment },
      })
      return item
    })
  } catch (error) {
    if (isUniqueViolation(error, 'plaid_items_plaid_item_id_unique')) {
      throw new ConflictError('That bank connection is already saved.')
    }
    throw error
  }
}

export type BankItemStateChange = 'webhook' | 'sync_failed' | 'reconnected'

/** Sets a connection's status. Audited when the status or error actually changes. */
export async function setBankItemState(
  actor: Actor,
  db: Db,
  input: { itemId: string; state: BankItemState; change: BankItemStateChange }
): Promise<BankItemRow> {
  authorize(actor, 'finances.manage')
  return db.transaction(async tx => {
    const [current] = await tx
      .select({ status: plaidItems.status, errorCode: plaidItems.errorCode })
      .from(plaidItems)
      .where(itemKey(actor, input.itemId))
      .limit(1)
      .for('update')
    if (!current) throw new NotFoundError(ITEM_NOT_FOUND)

    const [item] = await tx
      .update(plaidItems)
      .set({
        status: input.state.status,
        errorCode: input.state.errorCode,
        consentExpiresAt: input.state.consentExpiresAt,
      })
      .where(itemKey(actor, input.itemId))
      .returning(bankItemColumns)
    if (!item) throw new NotFoundError(ITEM_NOT_FOUND)

    if (current.status !== item.status || current.errorCode !== item.errorCode) {
      await recordAudit(actor, tx, {
        action: 'bank.status_changed',
        entity: 'plaid_item',
        entityId: item.id,
        metadata: {
          change: input.change,
          from: current.status,
          to: item.status,
          errorCode: item.errorCode,
        },
      })
    }
    return item
  })
}

/**
 * Turns a connection off. The access token has already been revoked at Plaid by the time this
 * runs, so the sealed copy is dropped along with the sync cursor: nothing left here can call the
 * bank. Everything the connection brought in — accounts, charges, their categories, notes and trip
 * tags — is left exactly as it is. Only deleteBankItemHistory ever removes those.
 */
export async function disconnectBankItem(ctx: RequestContext, db: Db, input: { itemId: string; now: Date }): Promise<BankItemRow> {
  requirePermission(ctx, 'finances.manage')
  return db.transaction(async tx => {
    const [current] = await tx
      .select({ status: plaidItems.status })
      .from(plaidItems)
      .where(itemKey(ctx, input.itemId))
      .limit(1)
      .for('update')
    if (!current) throw new NotFoundError(ITEM_NOT_FOUND)
    assertCanDisconnectBankItem(current)

    const [item] = await tx
      .update(plaidItems)
      .set({
        status: 'disconnected',
        disconnectedAt: input.now,
        errorCode: null,
        consentExpiresAt: null,
        accessTokenEncrypted: null,
        cursor: null,
      })
      .where(itemKey(ctx, input.itemId))
      .returning(bankItemColumns)
    if (!item) throw new NotFoundError(ITEM_NOT_FOUND)

    await recordAudit(ctx, tx, {
      action: 'bank.disconnected',
      entity: 'plaid_item',
      entityId: item.id,
      metadata: { institutionName: item.institutionName, from: current.status },
    })
    return item
  })
}

/** What a connection holds: what turning it off keeps, and what deleting its history would remove. */
export interface BankItemContents {
  accounts: number
  transactions: number
}

const NO_CONTENTS: BankItemContents = { accounts: 0, transactions: 0 }

async function readContents(db: Db, householdId: string, itemId?: string): Promise<Map<string, BankItemContents>> {
  const forItem = itemId === undefined ? undefined : eq(accounts.plaidItemId, itemId)
  const [accountRows, transactionRows] = await Promise.all([
    db
      .select({ itemId: accounts.plaidItemId, total: count() })
      .from(accounts)
      .where(and(eq(accounts.householdId, householdId), forItem))
      .groupBy(accounts.plaidItemId),
    db
      .select({ itemId: accounts.plaidItemId, total: count() })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(and(eq(transactions.householdId, householdId), forItem))
      .groupBy(accounts.plaidItemId),
  ])

  const contents = new Map<string, BankItemContents>()
  for (const row of accountRows) contents.set(row.itemId, { accounts: row.total, transactions: 0 })
  for (const row of transactionRows) {
    contents.set(row.itemId, { accounts: contents.get(row.itemId)?.accounts ?? 0, transactions: row.total })
  }
  return contents
}

/** Contents for every connection in the household, keyed by connection id. A connection with nothing is absent. */
export async function listBankItemContents(ctx: RequestContext, db: Db): Promise<Map<string, BankItemContents>> {
  requirePermission(ctx, 'finances.view')
  return readContents(db, ctx.householdId)
}

export async function getBankItemContents(ctx: RequestContext, db: Db, input: { itemId: string }): Promise<BankItemContents> {
  requirePermission(ctx, 'finances.view')
  return (await readContents(db, ctx.householdId, input.itemId)).get(input.itemId) ?? NO_CONTENTS
}

/**
 * Removes everything a turned-off connection brought in. This is the one path in Ghar that deletes
 * an account: its transactions, snapshots, holdings and liability details go with it through the
 * cascades, a goal or bill that pointed at it is left pointing at nothing, and the connection's own
 * row stays so its Plaid Item is never counted twice. Asked for by name, never as a side effect.
 */
export async function deleteBankItemHistory(
  ctx: RequestContext,
  db: Db,
  input: { itemId: string }
): Promise<{ item: BankItemRow; removed: BankItemContents }> {
  requirePermission(ctx, 'finances.manage')
  return db.transaction(async tx => {
    const [item] = await tx.select(bankItemColumns).from(plaidItems).where(itemKey(ctx, input.itemId)).limit(1).for('update')
    if (!item) throw new NotFoundError(ITEM_NOT_FOUND)
    if (item.status !== 'disconnected') {
      throw new ConflictError('Turn the connection off before deleting what it brought in.')
    }

    const removed = (await readContents(tx, ctx.householdId, item.id)).get(item.id) ?? NO_CONTENTS
    await tx.delete(accounts).where(and(eq(accounts.householdId, ctx.householdId), eq(accounts.plaidItemId, item.id)))

    await recordAudit(ctx, tx, {
      action: 'bank.history_deleted',
      entity: 'plaid_item',
      entityId: item.id,
      metadata: { institutionName: item.institutionName, ...removed },
    })
    return { item, removed }
  })
}

// ---------------------------------------------------------------------------------------------
// Sync

export interface TransactionSyncResult {
  accounts: number
  inserted: number
  updated: number
  deleted: number
}

/**
 * Applies everything one /transactions/sync run fetched, in one database transaction. The cursor
 * advances only if every row lands, so a failure part way leaves the next sync to fetch the same
 * changes again.
 *
 * `expectedCursor` is the cursor the fetch started from. If another sync advanced it in the
 * meantime, this throws a ConflictError and changes nothing.
 */
export async function applyTransactionSync(
  actor: Actor,
  db: Db,
  input: {
    itemId: string
    expectedCursor: string | null
    nextCursor: string
    accounts: readonly BankAccount[]
    pages: readonly TransactionChanges[]
    now: Date
  }
): Promise<TransactionSyncResult> {
  authorize(actor, 'finances.manage')
  return db.transaction(async tx => {
    const [item] = await tx
      .select({ id: plaidItems.id, cursor: plaidItems.cursor })
      .from(plaidItems)
      .where(itemKey(actor, input.itemId))
      .limit(1)
      .for('update')
    if (!item) throw new NotFoundError(ITEM_NOT_FOUND)
    if (item.cursor !== input.expectedCursor) {
      throw new ConflictError('This bank connection synced while this sync was running.')
    }

    await upsertAccounts(actor, tx, item.id, input.accounts, input.now)
    const accountIds = await accountIdsForItem(tx, item.id)

    const ids = transactionIdsToLoad(input.pages)
    const existing: StoredTransaction[] = []
    for (const chunk of chunks(ids)) {
      existing.push(
        ...(await tx
          .select({
            id: transactions.id,
            plaidTransactionId: transactions.plaidTransactionId,
            isPending: transactions.isPending,
            categoryId: transactions.categoryId,
            categorySource: transactions.categorySource,
            categoryConfidence: transactions.categoryConfidence,
            categoryRuleId: transactions.categoryRuleId,
            suggestedCategoryId: transactions.suggestedCategoryId,
            needsReview: transactions.needsReview,
            notes: transactions.notes,
            isExcluded: transactions.isExcluded,
          })
          .from(transactions)
          .where(and(eq(transactions.householdId, actor.householdId), inArray(transactions.plaidTransactionId, chunk)))
          // Matched on a Plaid id, so every row has one. Only charges typed in by hand lack it.
          .then(rows =>
            rows.flatMap(({ plaidTransactionId, ...row }) => (plaidTransactionId === null ? [] : [{ ...row, plaidTransactionId }]))
          ))
      )
    }

    const plan = planTransactionSync(existing, input.pages)

    for (const update of plan.updates) {
      if (update.mergedFromId === undefined) continue
      await tx.update(transactionEdits).set({ transactionId: update.id }).where(eq(transactionEdits.transactionId, update.mergedFromId))
    }

    for (const chunk of chunks(plan.deletes)) {
      await tx.delete(transactions).where(and(eq(transactions.householdId, actor.householdId), inArray(transactions.id, chunk)))
    }

    for (const update of plan.updates) {
      await tx
        .update(transactions)
        .set({
          ...bankFields(update.transaction, accountIds),
          ...update.userFields,
          updatedAt: input.now,
        })
        .where(and(eq(transactions.id, update.id), eq(transactions.householdId, actor.householdId)))
    }

    for (const chunk of chunks(plan.inserts)) {
      await tx.insert(transactions).values(
        chunk.map(transaction => ({
          householdId: actor.householdId,
          ...bankFields(transaction, accountIds),
          createdAt: input.now,
          updatedAt: input.now,
        }))
      )
    }

    await tx
      .update(plaidItems)
      .set({
        cursor: input.nextCursor,
        lastSyncedAt: input.now,
        status: 'good',
        errorCode: null,
      })
      .where(eq(plaidItems.id, item.id))

    return {
      accounts: input.accounts.length,
      inserted: plan.inserts.length,
      updated: plan.updates.length,
      deleted: plan.deletes.length,
    }
  })
}

/** Locks the household's item for the rest of the transaction, so two syncs of it apply in turn. */
async function lockItem(actor: Actor, tx: Db, itemId: string): Promise<string> {
  const [item] = await tx.select({ id: plaidItems.id }).from(plaidItems).where(itemKey(actor, itemId)).limit(1).for('update')
  if (!item) throw new NotFoundError(ITEM_NOT_FOUND)
  return item.id
}

/**
 * Applies /accounts/get: fresh balances for every account on the item, stamped `now`. A successful
 * call proves the login works, so it clears a stored error the same way a transaction sync does.
 */
export async function applyBalanceSync(
  actor: Actor,
  db: Db,
  input: { itemId: string; accounts: readonly BankAccount[]; now: Date }
): Promise<{ accounts: number }> {
  authorize(actor, 'finances.manage')
  return db.transaction(async tx => {
    const itemId = await lockItem(actor, tx, input.itemId)
    await upsertAccounts(actor, tx, itemId, input.accounts, input.now)
    await tx.update(plaidItems).set({ status: 'good', errorCode: null }).where(eq(plaidItems.id, itemId))
    return { accounts: input.accounts.length }
  })
}

/**
 * Applies /investments/holdings/get. The accounts' balances refresh as with a balance sync; the
 * holdings replace what the item's accounts held before, since a sold position simply stops appearing.
 * Holdings are composition only and never change an account's balance.
 */
export async function applyInvestmentsSync(
  actor: Actor,
  db: Db,
  input: { itemId: string; accounts: readonly BankAccount[]; holdings: readonly BankHolding[]; now: Date }
): Promise<{ accounts: number; holdings: number }> {
  authorize(actor, 'finances.manage')
  return db.transaction(async tx => {
    const itemId = await lockItem(actor, tx, input.itemId)
    await upsertAccounts(actor, tx, itemId, input.accounts, input.now)
    const accountIds = await accountIdsForItem(tx, itemId)
    const rows = input.holdings.map(holding => ({
      householdId: actor.householdId,
      accountId: knownAccountId(accountIds, holding.plaidAccountId),
      plaidSecurityId: holding.plaidSecurityId,
      ticker: holding.ticker,
      name: holding.name,
      securityType: holding.securityType,
      quantity: holding.quantity,
      costBasisCents: holding.costBasisCents,
      valueCents: holding.valueCents,
      asOf: holding.asOf,
      createdAt: input.now,
      updatedAt: input.now,
    }))
    if (accountIds.size > 0) await tx.delete(holdings).where(inArray(holdings.accountId, [...accountIds.values()]))
    for (const chunk of chunks(rows)) await tx.insert(holdings).values(chunk)
    return { accounts: input.accounts.length, holdings: rows.length }
  })
}

/**
 * Applies /liabilities/get. Balances refresh as with a balance sync; the detail for each liability
 * replaces the last, and an account Plaid no longer describes loses its stale detail.
 */
export async function applyLiabilitiesSync(
  actor: Actor,
  db: Db,
  input: { itemId: string; accounts: readonly BankAccount[]; liabilities: readonly BankLiability[]; now: Date }
): Promise<{ accounts: number; liabilities: number }> {
  authorize(actor, 'finances.manage')
  return db.transaction(async tx => {
    const itemId = await lockItem(actor, tx, input.itemId)
    await upsertAccounts(actor, tx, itemId, input.accounts, input.now)
    const accountIds = await accountIdsForItem(tx, itemId)
    const rows = input.liabilities.map(liability => ({
      householdId: actor.householdId,
      accountId: knownAccountId(accountIds, liability.plaidAccountId),
      kind: liability.kind,
      aprPercent: liability.aprPercent,
      minimumPaymentCents: liability.minimumPaymentCents,
      nextPaymentDueOn: liability.nextPaymentDueOn,
      lastPaymentCents: liability.lastPaymentCents,
      lastPaymentOn: liability.lastPaymentOn,
      originationDate: liability.originationDate,
      originalPrincipalCents: liability.originalPrincipalCents,
      isOverdue: liability.isOverdue,
      createdAt: input.now,
      updatedAt: input.now,
    }))
    const described = new Set(rows.map(row => row.accountId))
    const undescribed = [...accountIds.values()].filter(id => !described.has(id))
    if (undescribed.length > 0) await tx.delete(liabilityDetails).where(inArray(liabilityDetails.accountId, undescribed))
    for (const chunk of chunks(rows)) {
      await tx
        .insert(liabilityDetails)
        .values(chunk)
        .onConflictDoUpdate({
          target: liabilityDetails.accountId,
          set: {
            kind: excluded('kind'),
            aprPercent: excluded('apr_percent'),
            minimumPaymentCents: excluded('minimum_payment_cents'),
            nextPaymentDueOn: excluded('next_payment_due_on'),
            lastPaymentCents: excluded('last_payment_cents'),
            lastPaymentOn: excluded('last_payment_on'),
            originationDate: excluded('origination_date'),
            originalPrincipalCents: excluded('original_principal_cents'),
            isOverdue: excluded('is_overdue'),
            updatedAt: excluded('updated_at'),
          },
        })
    }
    return { accounts: input.accounts.length, liabilities: rows.length }
  })
}

function knownAccountId(accountIds: ReadonlyMap<string, string>, plaidAccountId: string): string {
  const accountId = accountIds.get(plaidAccountId)
  // Plaid described an account it didn't list. Fail the sync rather than guess.
  if (accountId === undefined) throw new Error('Sync returned detail for an unknown account')
  return accountId
}

async function upsertAccounts(actor: Actor, tx: Db, itemId: string, bankAccounts: readonly BankAccount[], now: Date): Promise<void> {
  if (bankAccounts.length === 0) return
  await tx
    .insert(accounts)
    .values(
      bankAccounts.map(account => ({
        householdId: actor.householdId,
        plaidItemId: itemId,
        plaidAccountId: account.plaidAccountId,
        name: account.name,
        officialName: account.officialName,
        mask: account.mask,
        type: account.type,
        subtype: account.subtype,
        currentBalanceCents: account.currentBalanceCents,
        availableBalanceCents: account.availableBalanceCents,
        isoCurrency: account.isoCurrency,
        balanceUpdatedAt: now,
      }))
    )
    .onConflictDoUpdate({
      target: [accounts.plaidItemId, accounts.plaidAccountId],
      // Everything from the bank. is_hidden belongs to the household and is left alone.
      set: {
        name: excluded('name'),
        officialName: excluded('official_name'),
        mask: excluded('mask'),
        type: excluded('type'),
        subtype: excluded('subtype'),
        currentBalanceCents: excluded('current_balance_cents'),
        availableBalanceCents: excluded('available_balance_cents'),
        isoCurrency: excluded('iso_currency'),
        balanceUpdatedAt: excluded('balance_updated_at'),
      },
    })
}

function excluded(column: string) {
  return sql.raw(`excluded.${column}`)
}

async function accountIdsForItem(tx: Db, itemId: string): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: accounts.id, plaidAccountId: accounts.plaidAccountId })
    .from(accounts)
    .where(eq(accounts.plaidItemId, itemId))
  return new Map(rows.map(row => [row.plaidAccountId, row.id]))
}

function bankFields(transaction: BankTransaction, accountIds: ReadonlyMap<string, string>) {
  const accountId = accountIds.get(transaction.plaidAccountId)
  if (accountId === undefined) {
    // Plaid sent a transaction for an account it didn't list. Fail the sync rather than guess.
    throw new Error('Sync returned a transaction for an unknown account')
  }
  return {
    accountId,
    plaidTransactionId: transaction.plaidTransactionId,
    pendingTransactionId: transaction.pendingTransactionId,
    amountCents: transaction.amountCents,
    isoCurrency: transaction.isoCurrency,
    date: transaction.date,
    authorizedDate: transaction.authorizedDate,
    merchantName: transaction.merchantName,
    name: transaction.name,
    paymentChannel: transaction.paymentChannel,
    plaidCategoryPrimary: transaction.categoryPrimary,
    plaidCategoryDetailed: transaction.categoryDetailed,
    plaidCategoryConfidence: transaction.categoryConfidence,
    isPending: transaction.isPending,
    isTransfer: isTransferTransaction(transaction),
  }
}

function* chunks<T>(items: readonly T[]): Generator<T[]> {
  for (let start = 0; start < items.length; start += CHUNK) {
    yield items.slice(start, start + CHUNK)
  }
}

// ---------------------------------------------------------------------------------------------
// Accounts

export interface AccountRow {
  id: string
  plaidItemId: string
  institutionName: string | null
  name: string
  officialName: string | null
  mask: string | null
  type: string
  subtype: string | null
  currentBalanceCents: number | null
  availableBalanceCents: number | null
  isoCurrency: string | null
  isHidden: boolean
  balanceUpdatedAt: Date | null
}

const accountColumns = {
  id: accounts.id,
  plaidItemId: accounts.plaidItemId,
  institutionName: plaidItems.institutionName,
  name: accounts.name,
  officialName: accounts.officialName,
  mask: accounts.mask,
  type: accounts.type,
  subtype: accounts.subtype,
  currentBalanceCents: accounts.currentBalanceCents,
  availableBalanceCents: accounts.availableBalanceCents,
  isoCurrency: accounts.isoCurrency,
  isHidden: accounts.isHidden,
  balanceUpdatedAt: accounts.balanceUpdatedAt,
}

function selectAccounts(db: Db) {
  return db.select(accountColumns).from(accounts).innerJoin(plaidItems, eq(plaidItems.id, accounts.plaidItemId))
}

const ACCOUNT_NOT_FOUND = 'That account no longer exists.'

export async function listAccounts(ctx: RequestContext, db: Db): Promise<AccountRow[]> {
  requirePermission(ctx, 'finances.view')
  return selectAccounts(db)
    .where(eq(accounts.householdId, ctx.householdId))
    .orderBy(asc(plaidItems.createdAt), asc(accounts.name), asc(accounts.id))
}

const accountOrder: Keyset = {
  keys: [
    { expr: plaidItems.createdAt, kind: 'timestamp' },
    { expr: accounts.name, kind: 'text' },
  ],
  id: accounts.id,
}

/** One page of listAccounts, in the same order. Hidden accounts are left out unless asked for. */
export async function listAccountsPage(
  ctx: RequestContext,
  db: Db,
  filter: { includeHidden: boolean },
  page: PageRequest
): Promise<Page<AccountRow>> {
  requirePermission(ctx, 'finances.view')
  const rows = await db
    .select({ ...accountColumns, pageKeys: pageKeys(accountOrder) })
    .from(accounts)
    .innerJoin(plaidItems, eq(plaidItems.id, accounts.plaidItemId))
    .where(
      and(
        eq(accounts.householdId, ctx.householdId),
        filter.includeHidden ? undefined : eq(accounts.isHidden, false),
        keysetAfter(accountOrder, page.after)
      )
    )
    .orderBy(...keysetOrder(accountOrder))
    .limit(page.limit + 1)
  return toPage(rows, page.limit)
}

export async function setAccountHidden(ctx: RequestContext, db: Db, input: { accountId: string; isHidden: boolean }): Promise<AccountRow> {
  requirePermission(ctx, 'finances.manage')
  const key = and(eq(accounts.id, input.accountId), eq(accounts.householdId, ctx.householdId))
  return db.transaction(async tx => {
    const [current] = await tx.select({ isHidden: accounts.isHidden }).from(accounts).where(key).limit(1).for('update')
    if (!current) throw new NotFoundError(ACCOUNT_NOT_FOUND)

    if (current.isHidden !== input.isHidden) {
      await tx.update(accounts).set({ isHidden: input.isHidden }).where(key)
      await recordAudit(ctx, tx, {
        action: input.isHidden ? 'account.hidden' : 'account.shown',
        entity: 'account',
        entityId: input.accountId,
      })
    }

    const [account] = await selectAccounts(tx).where(key).limit(1)
    if (!account) throw new NotFoundError(ACCOUNT_NOT_FOUND)
    return account
  })
}

// ---------------------------------------------------------------------------------------------
// Transactions

export interface TransactionRow {
  id: string
  /** Null on a charge typed in by hand, which belongs to no account. */
  accountId: string | null
  accountName: string | null
  accountMask: string | null
  institutionName: string | null
  /** The trip this charge is tagged to, which is what makes a trip's actual spend add up. */
  tripId: string | null
  amountCents: number
  isoCurrency: string | null
  date: string
  authorizedDate: string | null
  merchantName: string | null
  name: string
  paymentChannel: string | null
  plaidCategoryPrimary: string | null
  plaidCategoryDetailed: string | null
  categoryId: string | null
  categoryName: string | null
  categorySource: CategorySource | null
  /** The model's confidence as a whole percent, on a category it assigned or suggested. */
  categoryConfidence: number | null
  categoryRuleId: string | null
  suggestedCategoryId: string | null
  needsReview: boolean
  isPending: boolean
  isTransfer: boolean
  isExcluded: boolean
  notes: string | null
  updatedAt: Date
}

/** `extra` is how the paged list adds its `pageKeys` without a second copy of the joins. */
function selectTransactions<Extra extends Record<string, SQL>>(db: Db, extra: Extra = {} as Extra) {
  return db
    .select({
      ...extra,
      id: transactions.id,
      // Left joined: a charge typed in by hand belongs to no account, and is still the household's
      // money. Everything about an account is null on those.
      accountId: accounts.id,
      accountName: accounts.name,
      accountMask: accounts.mask,
      institutionName: plaidItems.institutionName,
      tripId: transactions.tripId,
      amountCents: transactions.amountCents,
      isoCurrency: transactions.isoCurrency,
      date: transactions.date,
      authorizedDate: transactions.authorizedDate,
      merchantName: transactions.merchantName,
      name: transactions.name,
      paymentChannel: transactions.paymentChannel,
      plaidCategoryPrimary: transactions.plaidCategoryPrimary,
      plaidCategoryDetailed: transactions.plaidCategoryDetailed,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      categorySource: transactions.categorySource,
      categoryConfidence: transactions.categoryConfidence,
      categoryRuleId: transactions.categoryRuleId,
      suggestedCategoryId: transactions.suggestedCategoryId,
      needsReview: transactions.needsReview,
      isPending: transactions.isPending,
      isTransfer: transactions.isTransfer,
      isExcluded: transactions.isExcluded,
      notes: transactions.notes,
      updatedAt: transactions.updatedAt,
    })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(plaidItems, eq(plaidItems.id, accounts.plaidItemId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
}

/**
 * A charge on a hidden account is out of sight everywhere it isn't asked for by name. One typed in
 * by hand has no account at all, and is always the household's own.
 */
function visibleAccount() {
  return or(isNull(transactions.accountId), eq(accounts.isHidden, false))
}

export interface TransactionFilters {
  /** Inclusive calendar dates. */
  from?: string
  to?: string
  /** Without one, transactions on hidden accounts are left out. */
  accountId?: string
  /** One category exactly, or the literal 'none' for everything still uncategorized. */
  categoryId?: string
  /** One trip exactly, or the literal 'none' for everything tagged to no trip. */
  tripId?: string
  /** Bounds on the size of the amount, in or out. */
  minCents?: number
  maxCents?: number
  /** Matches the name, merchant or notes. */
  q?: string
  /** Only the review queue: see reviewConditions. */
  review?: boolean
}

/**
 * Transactions waiting for a person to pick a category: nothing automatic decided one, nobody
 * cleared it on purpose, and the household hasn't excluded it.
 */
function reviewConditions() {
  return [isNull(transactions.categoryId), isNull(transactions.categorySource), eq(transactions.isExcluded, false)]
}

export async function countReviewQueue(ctx: RequestContext, db: Db): Promise<number> {
  requirePermission(ctx, 'finances.view')
  const [row] = await db
    .select({ total: count() })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(eq(transactions.householdId, ctx.householdId), visibleAccount(), ...reviewConditions()))
  return row?.total ?? 0
}

/**
 * The order the money screen and every trip list share: newest first, ties broken by when the row
 * arrived and then by its id.
 */
const transactionOrder: Keyset = {
  keys: [
    { expr: transactions.date, kind: 'date', desc: true },
    { expr: transactions.createdAt, kind: 'timestamp', desc: true },
  ],
  id: transactions.id,
  idDesc: true,
}

function transactionConditions(ctx: RequestContext, filters: TransactionFilters): (SQL | undefined)[] {
  const conditions = [eq(transactions.householdId, ctx.householdId)]
  if (filters.from !== undefined) conditions.push(gte(transactions.date, filters.from))
  if (filters.to !== undefined) conditions.push(lte(transactions.date, filters.to))
  const account = filters.accountId === undefined ? visibleAccount() : eq(transactions.accountId, filters.accountId)
  if (account) conditions.push(account)
  if (filters.categoryId !== undefined) {
    conditions.push(filters.categoryId === 'none' ? isNull(transactions.categoryId) : eq(transactions.categoryId, filters.categoryId))
  }
  if (filters.tripId !== undefined) {
    conditions.push(filters.tripId === 'none' ? isNull(transactions.tripId) : eq(transactions.tripId, filters.tripId))
  }
  if (filters.minCents !== undefined) {
    conditions.push(sql`abs(${transactions.amountCents}) >= ${filters.minCents}`)
  }
  if (filters.maxCents !== undefined) {
    conditions.push(sql`abs(${transactions.amountCents}) <= ${filters.maxCents}`)
  }
  const q = filters.q?.trim()
  if (q) {
    const pattern = `%${q.replace(/[\\%_]/g, character => `\\${character}`)}%`
    const matches = or(ilike(transactions.name, pattern), ilike(transactions.merchantName, pattern), ilike(transactions.notes, pattern))
    if (matches) conditions.push(matches)
  }
  if (filters.review) conditions.push(...reviewConditions())
  return conditions
}

/** One page of charges, newest first. */
export async function listTransactions(
  ctx: RequestContext,
  db: Db,
  filters: TransactionFilters,
  page: PageRequest
): Promise<Page<TransactionRow>> {
  requirePermission(ctx, 'finances.view')
  const rows = await selectTransactions(db, { pageKeys: pageKeys(transactionOrder) })
    .where(and(...transactionConditions(ctx, filters), keysetAfter(transactionOrder, page.after)))
    .orderBy(...keysetOrder(transactionOrder))
    .limit(page.limit + 1)
  return toPage(rows, page.limit)
}

export interface TransactionMonthTotal {
  /** The first of the month. */
  month: string
  /** Money out, as a positive figure. */
  outCents: number
  /** Money in. */
  inCents: number
  count: number
}

/**
 * What the charges a filter matches add up to, a month at a time. The same rows the list shows,
 * less the ones the household excluded, which it has said not to count.
 */
export async function listTransactionMonthTotals(
  ctx: RequestContext,
  db: Db,
  filters: TransactionFilters
): Promise<TransactionMonthTotal[]> {
  requirePermission(ctx, 'finances.view')
  const month = sql<string>`to_char(${transactions.date}, 'YYYY-MM') || '-01'`
  return db
    .select({
      month,
      outCents: sql<number>`coalesce(sum(-${transactions.amountCents}) filter (where ${transactions.amountCents} < 0), 0)`.mapWith(Number),
      inCents: sql<number>`coalesce(sum(${transactions.amountCents}) filter (where ${transactions.amountCents} > 0), 0)`.mapWith(Number),
      count: count(),
    })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(...transactionConditions(ctx, filters), eq(transactions.isExcluded, false)))
    .groupBy(month)
    .orderBy(month)
}

const TRANSACTION_NOT_FOUND = 'That transaction no longer exists.'

export async function getTransaction(ctx: RequestContext, db: Db, input: { transactionId: string }): Promise<TransactionRow> {
  requirePermission(ctx, 'finances.view')
  const [row] = await selectTransactions(db).where(transactionKey(ctx, input.transactionId)).limit(1)
  if (!row) throw new NotFoundError(TRANSACTION_NOT_FOUND)
  return row
}

export interface TransactionEditInput {
  transactionId: string
  categoryId?: string | null
  notes?: string | null
  isExcluded?: boolean
}

/**
 * Changes what a person owns on a transaction. Each changed field is logged in transaction_edits.
 * A category set here is a person's decision, so it replaces whatever automatic categorization
 * said, including a question left for review, and nothing automatic changes it again.
 */
export async function updateTransaction(ctx: RequestContext, db: Db, input: TransactionEditInput): Promise<TransactionRow> {
  requirePermission(ctx, 'finances.manage')
  const key = transactionKey(ctx, input.transactionId)
  return db.transaction(async tx => {
    const [current] = await tx
      .select({
        categoryId: transactions.categoryId,
        notes: transactions.notes,
        isExcluded: transactions.isExcluded,
      })
      .from(transactions)
      .where(key)
      .limit(1)
      .for('update')
    if (!current) throw new NotFoundError(TRANSACTION_NOT_FOUND)

    if (input.categoryId !== undefined && input.categoryId !== null) {
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, input.categoryId), eq(categories.householdId, ctx.householdId), eq(categories.isArchived, false)))
        .limit(1)
      if (!category) {
        throw new ValidationError('Choose one of your categories.', {
          details: { fieldErrors: { categoryId: ['Choose one of your categories.'] } },
        })
      }
    }

    const edits: { field: string; oldValue: string | null; newValue: string | null }[] = []
    const changes: Partial<typeof transactions.$inferInsert> = {}
    if (input.categoryId !== undefined && input.categoryId !== current.categoryId) {
      Object.assign(changes, {
        categoryId: input.categoryId,
        categorySource: 'user',
        categoryConfidence: null,
        categoryRuleId: null,
        suggestedCategoryId: null,
        needsReview: false,
      } satisfies Partial<typeof transactions.$inferInsert>)
      edits.push({
        field: 'category_id',
        oldValue: current.categoryId,
        newValue: input.categoryId,
      })
    }
    if (input.notes !== undefined && input.notes !== current.notes) {
      changes.notes = input.notes
      edits.push({ field: 'notes', oldValue: current.notes, newValue: input.notes })
    }
    if (input.isExcluded !== undefined && input.isExcluded !== current.isExcluded) {
      changes.isExcluded = input.isExcluded
      edits.push({
        field: 'is_excluded',
        oldValue: String(current.isExcluded),
        newValue: String(input.isExcluded),
      })
    }

    if (edits.length > 0) {
      await tx
        .update(transactions)
        .set({ ...changes, updatedAt: sql`now()` })
        .where(key)
      await tx.insert(transactionEdits).values(
        edits.map(edit => ({
          transactionId: input.transactionId,
          userId: ctx.userId,
          ...edit,
        }))
      )
      await recordAudit(ctx, tx, {
        action: 'transaction.updated',
        entity: 'transaction',
        entityId: input.transactionId,
        metadata: { fields: edits.map(edit => edit.field) },
      })
    }

    const [row] = await selectTransactions(tx).where(key).limit(1)
    if (!row) throw new NotFoundError(TRANSACTION_NOT_FOUND)
    return row
  })
}

function transactionKey(ctx: RequestContext, transactionId: string) {
  return and(eq(transactions.id, transactionId), eq(transactions.householdId, ctx.householdId))
}
