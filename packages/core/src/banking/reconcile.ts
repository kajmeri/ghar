import type { CategorySource } from '../finances/types'
import type { BankTransaction, TransactionChanges } from './types'

/** How a transaction came to have its category, or why it has none. Always moves as one unit. */
export interface TransactionCategorization {
  categoryId: string | null
  categorySource: CategorySource | null
  /** The model's confidence as a whole percent. Only set by the model. */
  categoryConfidence: number | null
  categoryRuleId: string | null
  /** The model's best guess when it wasn't sure enough to assign it. */
  suggestedCategoryId: string | null
  needsReview: boolean
}

/**
 * What the household and Ghar have decided about a transaction, as opposed to what the bank
 * reports. Bank updates never overwrite these.
 */
export interface TransactionUserFields extends TransactionCategorization {
  notes: string | null
  isExcluded: boolean
}

/** The parts of a stored transaction the reconciler reads. */
export interface StoredTransaction extends TransactionUserFields {
  id: string
  plaidTransactionId: string
  isPending: boolean
}

export interface TransactionUpdate {
  /** The stored row to overwrite with the bank's fields. */
  id: string
  /**
   * The bank's latest version. Its plaidTransactionId differs from the row's when a pending row
   * takes over its posted transaction's ID.
   */
  transaction: BankTransaction
  /** Set when a pending row's edits move onto this one. Replaces the row's user fields. */
  userFields?: TransactionUserFields
  /** The pending row being folded into this one. Move its edit history here before deleting it. */
  mergedFromId?: string
}

/**
 * Row-level changes for one sync. Apply them in one database transaction, in this order: move
 * the edit history named by `mergedFromId`, then `deletes`, then `updates`, then `inserts`. That
 * order never trips the unique plaid_transaction_id constraint.
 */
export interface TransactionSyncPlan {
  deletes: string[]
  updates: TransactionUpdate[]
  inserts: BankTransaction[]
}

/**
 * Collapses sync pages into the final state of each transaction. Pages apply in order and, within
 * a page, added then modified then removed, so the last word on an ID wins.
 */
export function foldTransactionChanges(pages: readonly TransactionChanges[]): {
  upserts: BankTransaction[]
  removed: string[]
} {
  const latest = new Map<string, BankTransaction | null>()
  const record = (id: string, transaction: BankTransaction | null) => {
    latest.delete(id)
    latest.set(id, transaction)
  }
  for (const page of pages) {
    for (const transaction of page.added) record(transaction.plaidTransactionId, transaction)
    for (const transaction of page.modified) record(transaction.plaidTransactionId, transaction)
    for (const id of page.removed) record(id, null)
  }

  const upserts: BankTransaction[] = []
  const removed: string[] = []
  for (const [id, transaction] of latest) {
    if (transaction) upserts.push(transaction)
    else removed.push(id)
  }
  return { upserts, removed }
}

/** Every Plaid transaction ID the plan may need to look up: changed, removed, and replaced. */
export function transactionIdsToLoad(pages: readonly TransactionChanges[]): string[] {
  const ids = new Set<string>()
  for (const page of pages) {
    for (const transaction of [...page.added, ...page.modified]) {
      ids.add(transaction.plaidTransactionId)
      if (transaction.pendingTransactionId) ids.add(transaction.pendingTransactionId)
    }
    for (const id of page.removed) ids.add(id)
  }
  return [...ids]
}

/**
 * Works out how a batch of sync pages changes the stored transactions.
 *
 * `existing` must include every stored row whose Plaid ID is in transactionIdsToLoad(pages).
 *
 * The hard part is a pending transaction posting. Plaid sends the posted one under a new ID with
 * `pendingTransactionId` pointing back, and usually removes the pending one in the same batch.
 * The pending row is kept and takes over the new ID, so its row ID, category, notes, exclusion
 * and edit history survive, and the removal of the old ID leaves it alone. If a row already
 * exists under the posted ID, that row wins and the pending row's edits fill in what it lacks.
 *
 * Planning the same batch again against the result changes nothing.
 */
export function planTransactionSync(existing: readonly StoredTransaction[], pages: readonly TransactionChanges[]): TransactionSyncPlan {
  const { upserts, removed } = foldTransactionChanges(pages)
  const stored = new Map(existing.map(row => [row.plaidTransactionId, row]))
  const incoming = new Map(upserts.map(transaction => [transaction.plaidTransactionId, transaction]))

  // First pass: each posted transaction claims the pending one it replaces. A pending
  // transaction can be claimed once, and the first posted transaction in the batch gets it.
  const replacedBy = new Map<string, string>()
  const replaces = new Map<string, string>()
  for (const transaction of upserts) {
    const pendingId = transaction.pendingTransactionId
    if (transaction.isPending || !pendingId || pendingId === transaction.plaidTransactionId) {
      continue
    }
    if (replacedBy.has(pendingId)) continue
    if (!isPendingVersion(stored.get(pendingId), incoming.get(pendingId))) continue
    replacedBy.set(pendingId, transaction.plaidTransactionId)
    replaces.set(transaction.plaidTransactionId, pendingId)
  }

  const plan: TransactionSyncPlan = { deletes: [], updates: [], inserts: [] }

  for (const transaction of upserts) {
    // A pending version whose posted transaction is in this batch. The posted one covers it.
    if (replacedBy.has(transaction.plaidTransactionId)) continue

    const current = stored.get(transaction.plaidTransactionId)
    const pendingId = replaces.get(transaction.plaidTransactionId)
    const pending = pendingId === undefined ? undefined : stored.get(pendingId)

    if (current && pending) {
      plan.deletes.push(pending.id)
      plan.updates.push({
        id: current.id,
        transaction,
        userFields: mergeUserFields(current, pending),
        mergedFromId: pending.id,
      })
    } else if (current) {
      plan.updates.push({ id: current.id, transaction })
    } else if (pending) {
      plan.updates.push({ id: pending.id, transaction })
    } else {
      plan.inserts.push(transaction)
    }
  }

  for (const id of removed) {
    // The pending row lives on under its posted ID.
    if (replacedBy.has(id)) continue
    const row = stored.get(id)
    if (row) plan.deletes.push(row.id)
  }

  return plan
}

/**
 * Whether an ID names a pending transaction a posted one can replace. The batch's own version
 * of it, when there is one, has to still be pending: a posted transaction is never replaced.
 */
function isPendingVersion(row: StoredTransaction | undefined, batchVersion: BankTransaction | undefined): boolean {
  if (batchVersion && !batchVersion.isPending) return false
  if (row) return row.isPending
  return batchVersion !== undefined
}

/**
 * The posted row's own edits win. The pending row's fill in anything it hasn't set. The
 * categorization moves whole, from whichever row decided more: a person's choice beats an
 * automatic category, which beats a question left for review, which beats nothing.
 */
function mergeUserFields(posted: TransactionUserFields, pending: TransactionUserFields): TransactionUserFields {
  const categorization = categorizationRank(pending) > categorizationRank(posted) ? pending : posted
  return {
    categoryId: categorization.categoryId,
    categorySource: categorization.categorySource,
    categoryConfidence: categorization.categoryConfidence,
    categoryRuleId: categorization.categoryRuleId,
    suggestedCategoryId: categorization.suggestedCategoryId,
    needsReview: categorization.needsReview,
    notes: posted.notes ?? pending.notes,
    isExcluded: posted.isExcluded || pending.isExcluded,
  }
}

function categorizationRank(fields: TransactionCategorization): number {
  if (fields.categorySource === 'user') return 3
  if (fields.categoryId !== null) return 2
  if (fields.needsReview) return 1
  return 0
}
