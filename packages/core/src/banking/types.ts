import type { CalendarDate } from '../dates'
import type { Cents } from '../money'

/**
 * Where a connection lives. `fake` is Ghar's stand-in for Plaid, used without keys and in dry-run
 * mode: it never talks to Plaid, so it never spends an Item.
 */
export const BANK_ENVIRONMENTS = ['fake', 'sandbox', 'production'] as const
export type BankEnvironment = (typeof BANK_ENVIRONMENTS)[number]

export const BANK_ITEM_STATUSES = ['good', 'login_required', 'error'] as const
export type BankItemStatus = (typeof BANK_ITEM_STATUSES)[number]

/** An account as the bank reports it. */
export interface BankAccount {
  plaidAccountId: string
  name: string
  officialName: string | null
  mask: string | null
  /** Plaid's type: depository, credit, loan, investment, other. */
  type: string
  subtype: string | null
  currentBalanceCents: Cents | null
  availableBalanceCents: Cents | null
  isoCurrency: string | null
}

/** A transaction as the bank reports it. */
export interface BankTransaction {
  plaidTransactionId: string
  plaidAccountId: string
  /** On a posted transaction, the ID of the pending one it replaces. */
  pendingTransactionId: string | null
  /** Negative is money out, positive is money in. The opposite of Plaid's sign. */
  amountCents: Cents
  isoCurrency: string | null
  date: CalendarDate
  authorizedDate: CalendarDate | null
  merchantName: string | null
  name: string
  paymentChannel: string | null
  categoryPrimary: string | null
  categoryDetailed: string | null
  /** Plaid's confidence in the category: VERY_HIGH, HIGH, MEDIUM, LOW or UNKNOWN. */
  categoryConfidence: string | null
  isPending: boolean
}

/** One page of /transactions/sync. `removed` holds Plaid transaction IDs. */
export interface TransactionChanges {
  added: readonly BankTransaction[]
  modified: readonly BankTransaction[]
  removed: readonly string[]
}

/** What a Plaid webhook means for Ghar, once verified and parsed. */
export type BankWebhookEvent =
  | { kind: 'sync_available'; plaidItemId: string }
  | { kind: 'item_error'; plaidItemId: string; errorCode: string }
  | { kind: 'login_repaired'; plaidItemId: string }
  /** Consent runs out soon. The connection still works until then. */
  | { kind: 'consent_expiring'; plaidItemId: string; expiresAt: Date | null }
  | { kind: 'permission_revoked'; plaidItemId: string }
  | { kind: 'ignored'; webhookType: string; webhookCode: string; plaidItemId: string | null }
