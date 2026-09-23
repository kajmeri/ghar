import type { CalendarDate } from '../dates'
import type { Cents } from '../money'

/**
 * Where a connection lives. `fake` is Ghar's stand-in for Plaid, used without keys and in dry-run
 * mode: it never talks to Plaid, so it never spends an Item.
 */
export const BANK_ENVIRONMENTS = ['fake', 'sandbox', 'production'] as const
export type BankEnvironment = (typeof BANK_ENVIRONMENTS)[number]

/**
 * `disconnected` is Ghar's own: somebody turned the connection off, and the access token was
 * revoked at Plaid. Nothing syncs after, and the rows it brought in all stay.
 */
export const BANK_ITEM_STATUSES = ['good', 'login_required', 'error', 'disconnected'] as const
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

/** One position from /investments/holdings/get, with its security's details. */
export interface BankHolding {
  plaidAccountId: string
  plaidSecurityId: string
  ticker: string | null
  name: string | null
  /** Plaid's security type: equity, etf, mutual fund, fixed income, cash, cryptocurrency, derivative, other. */
  securityType: string | null
  /** Shares or units. */
  quantity: number
  /** What was paid for the whole position. Null when the institution doesn't report it. */
  costBasisCents: Cents | null
  valueCents: Cents
  /** When the institution last priced it. */
  asOf: CalendarDate
}

/** The detail /liabilities/get adds to a credit card, student loan or mortgage. Amounts are never negative. */
export interface BankLiability {
  plaidAccountId: string
  kind: 'credit' | 'student' | 'mortgage'
  /** A card's purchase APR, or a loan's interest rate, as a percent. */
  aprPercent: number | null
  minimumPaymentCents: Cents | null
  nextPaymentDueOn: CalendarDate | null
  lastPaymentCents: Cents | null
  lastPaymentOn: CalendarDate | null
  originationDate: CalendarDate | null
  originalPrincipalCents: Cents | null
  isOverdue: boolean
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

/** Everything one /transactions/sync run fetched, however many pages it took. */
export interface BankTransactionSync {
  /** The connection's accounts as the same response reports them. */
  accounts: readonly BankAccount[]
  pages: readonly TransactionChanges[]
  /** Store this only once every page has been applied. */
  nextCursor: string
  /** More changes are waiting. Sync again from `nextCursor` to fetch them. */
  hasMore: boolean
}

/** A short-lived token that opens the bank's sign-in flow in the browser. */
export interface BankLinkToken {
  token: string
  expiresAt: Date
}

/** What a finished sign-in leaves behind. The access token is sealed before it is stored. */
export interface BankItemCredentials {
  accessToken: string
  plaidItemId: string
}

/** The bank behind a connection, for showing which one it is. */
export interface BankInstitution {
  institutionId: string | null
  name: string | null
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
