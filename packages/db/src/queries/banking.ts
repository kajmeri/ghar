import { requirePermission } from '@ghar/core/auth'
import {
  assertCanCreateBankItem,
  isTransferTransaction,
  planTransactionSync,
  transactionIdsToLoad,
  type BankAccount,
  type BankEnvironment,
  type BankItemState,
  type BankTransaction,
  type StoredTransaction,
  type TransactionChanges,
  type TransactionListCursor,
} from '@ghar/core/banking'
import { ConflictError, NotFoundError, ValidationError } from '@ghar/core/errors'
import type { CategorySource } from '@ghar/core/finances'
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { accounts, categories, plaidItems, transactionEdits, transactions } from '../schema'
import { recordAudit } from './audit'
import { authorize } from './authorize'
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
  createdAt: plaidItems.createdAt,
}

const ITEM_NOT_FOUND = 'That bank connection no longer exists.'

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
  return row
}

/**
 * Every Item ever stored in an environment, across households, including disconnected ones.
 * Production Items are a lifetime allowance, so nothing here is ever subtracted.
 */
export async function countBankItemsByEnvironment(db: Db, environment: BankEnvironment): Promise<number> {
  const [row] = await db.select({ total: count() }).from(plaidItems).where(eq(plaidItems.environment, environment))
  return row?.total ?? 0
}

/** For the cron sync: every connection in every household, oldest first. */
export async function listBankItemsForSync(db: Db): Promise<BankItemRow[]> {
  return db.select(bankItemColumns).from(plaidItems).orderBy(asc(plaidItems.createdAt))
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

function selectAccounts(db: Db) {
  return db
    .select({
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
    })
    .from(accounts)
    .innerJoin(plaidItems, eq(plaidItems.id, accounts.plaidItemId))
}

const ACCOUNT_NOT_FOUND = 'That account no longer exists.'

export async function listAccounts(ctx: RequestContext, db: Db): Promise<AccountRow[]> {
  requirePermission(ctx, 'finances.view')
  return selectAccounts(db)
    .where(eq(accounts.householdId, ctx.householdId))
    .orderBy(asc(plaidItems.createdAt), asc(accounts.name), asc(accounts.id))
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
  accountId: string
  accountName: string
  accountMask: string | null
  institutionName: string | null
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

function selectTransactions(db: Db) {
  return db
    .select({
      id: transactions.id,
      // The inner join below means an account is always there; the transaction's own column is
      // nullable because charges typed in by hand have none.
      accountId: accounts.id,
      accountName: accounts.name,
      accountMask: accounts.mask,
      institutionName: plaidItems.institutionName,
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
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .innerJoin(plaidItems, eq(plaidItems.id, accounts.plaidItemId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
}

export interface TransactionFilters {
  /** Inclusive calendar dates. */
  from?: string
  to?: string
  /** Without one, transactions on hidden accounts are left out. */
  accountId?: string
  /** Bounds on the size of the amount, in or out. */
  minCents?: number
  maxCents?: number
  /** Matches the name, merchant or notes. */
  q?: string
  /** Only the review queue: see reviewConditions. */
  review?: boolean
  cursor?: TransactionListCursor
  limit: number
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
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(eq(transactions.householdId, ctx.householdId), eq(accounts.isHidden, false), ...reviewConditions()))
  return row?.total ?? 0
}

/** Newest first. `next` is the cursor for the following page, or null on the last. */
export async function listTransactions(
  ctx: RequestContext,
  db: Db,
  filters: TransactionFilters
): Promise<{ transactions: TransactionRow[]; next: TransactionListCursor | null }> {
  requirePermission(ctx, 'finances.view')
  const conditions = [eq(transactions.householdId, ctx.householdId)]
  if (filters.from !== undefined) conditions.push(gte(transactions.date, filters.from))
  if (filters.to !== undefined) conditions.push(lte(transactions.date, filters.to))
  conditions.push(filters.accountId === undefined ? eq(accounts.isHidden, false) : eq(transactions.accountId, filters.accountId))
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
  if (filters.cursor) {
    const after = or(
      lt(transactions.date, filters.cursor.date),
      and(eq(transactions.date, filters.cursor.date), lt(transactions.id, filters.cursor.id))
    )
    if (after) conditions.push(after)
  }

  const rows = await selectTransactions(db)
    .where(and(...conditions))
    .orderBy(desc(transactions.date), desc(transactions.id))
    .limit(filters.limit + 1)

  const page = rows.slice(0, filters.limit)
  const last = page.at(-1)
  return {
    transactions: page,
    next: rows.length > filters.limit && last ? { date: last.date, id: last.id } : null,
  }
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
