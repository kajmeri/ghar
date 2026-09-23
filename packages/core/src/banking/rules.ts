import { ConflictError, ValidationError } from '../errors'
import type { Cents } from '../money'
import type { BankEnvironment, BankItemStatus, BankTransaction, BankWebhookEvent } from './types'

/**
 * Ghar's Plaid plan allows this many production Items in total, ever. Removing an Item does not
 * give its slot back, so every production connection is permanent spend.
 */
export const PLAID_PRODUCTION_ITEM_LIMIT = 10

/**
 * Refuses to create a connection that would go past the production Item limit. Sandbox and fake
 * connections are free. `productionItemsCreated` counts every production Item Ghar has ever
 * stored, including ones since disconnected.
 */
export function assertCanCreateBankItem(input: { environment: BankEnvironment; productionItemsCreated: number }): void {
  if (input.environment !== 'production') return
  if (input.productionItemsCreated >= PLAID_PRODUCTION_ITEM_LIMIT) {
    throw new ConflictError(
      `Ghar has used all ${PLAID_PRODUCTION_ITEM_LIMIT} bank connections its Plaid plan allows. Reconnect an existing bank instead.`
    )
  }
}

/** Plaid errors a person fixes by signing in to their bank again through Link's update mode. */
const RELINK_ERROR_CODES = new Set([
  'ITEM_LOGIN_REQUIRED',
  'PENDING_EXPIRATION',
  'PENDING_DISCONNECT',
  'ACCESS_NOT_GRANTED',
  'INSUFFICIENT_CREDENTIALS',
  'INVALID_CREDENTIALS',
  'INVALID_MFA',
  'INVALID_UPDATED_USERNAME',
  'ITEM_LOCKED',
  'NO_ACCOUNTS',
  'USER_SETUP_REQUIRED',
])

/**
 * Plaid errors no sync or update-mode Link can fix. The Item is gone for good, and connecting the
 * bank again creates a new Item.
 */
const PERMANENT_ERROR_CODES = new Set(['USER_PERMISSION_REVOKED', 'ITEM_NOT_FOUND', 'INVALID_ACCESS_TOKEN'])

export const PERMISSION_REVOKED_CODE = 'USER_PERMISSION_REVOKED'

export function bankItemStatusForError(errorCode: string): BankItemStatus {
  return RELINK_ERROR_CODES.has(errorCode) ? 'login_required' : 'error'
}

export interface BankItemState {
  status: BankItemStatus
  errorCode: string | null
  consentExpiresAt: Date | null
}

/**
 * How a webhook changes a connection, or null when it changes nothing by itself (new
 * transactions are picked up by the sync the webhook triggers).
 */
export function bankItemStateForWebhook(event: BankWebhookEvent, current: BankItemState, now: Date): BankItemState | null {
  // A connection the household turned off has no token left to act on. Plaid may still send one
  // last webhook about it; nothing it says brings the connection back.
  if (current.status === 'disconnected') return null
  switch (event.kind) {
    case 'item_error':
      return {
        ...current,
        status: bankItemStatusForError(event.errorCode),
        errorCode: event.errorCode,
      }
    case 'login_repaired':
      return { ...current, status: 'good', errorCode: null }
    case 'consent_expiring':
      // Still working, so the status stays. The date drives the reconnect banner.
      return {
        ...current,
        consentExpiresAt: event.expiresAt ?? new Date(now.getTime() + CONSENT_WARNING_MS),
      }
    case 'permission_revoked':
      return { ...current, status: 'error', errorCode: PERMISSION_REVOKED_CODE }
    case 'sync_available':
    case 'ignored':
      return null
  }
}

const CONSENT_WARNING_MS = 7 * 24 * 60 * 60 * 1000

export type BankItemAttention =
  /** Sign in again through update mode. */
  | 'reconnect'
  /** Works for now, but consent runs out within a week. Update mode renews it. */
  | 'consent_expiring'
  /** Taken away at the bank. Connecting again makes a new Item. */
  | 'revoked'
  /** A temporary problem. The next sync may clear it. */
  | 'sync_error'

/**
 * What a connection needs from a person, or null when it needs nothing. A connection the
 * household turned off needs nothing: that is a resting state, not a problem, and the screen
 * says so in its own words.
 */
export function bankItemAttention(item: BankItemState, now: Date): BankItemAttention | null {
  if (item.status === 'disconnected') return null
  if (item.errorCode !== null && PERMANENT_ERROR_CODES.has(item.errorCode)) return 'revoked'
  if (item.status === 'login_required') return 'reconnect'
  if (item.consentExpiresAt !== null && item.consentExpiresAt.getTime() - now.getTime() <= CONSENT_WARNING_MS) {
    return 'consent_expiring'
  }
  if (item.status === 'error') return 'sync_error'
  return null
}

/** Whether update-mode Link can repair the connection without creating a new Item. */
export function canReconnectBankItem(item: BankItemState, now: Date): boolean {
  const attention = bankItemAttention(item, now)
  return attention === 'reconnect' || attention === 'consent_expiring'
}

/**
 * Turning a connection off is a one-way door until the bank is connected again, so asking twice is
 * a mistake worth naming rather than a quiet no-op.
 */
export function assertCanDisconnectBankItem(item: Pick<BankItemState, 'status'>): void {
  if (item.status === 'disconnected') throw new ConflictError('That connection is already turned off.')
}

/**
 * Whether a scheduled sync should call Plaid for this connection. One that needs a sign-in or is
 * gone would only fail again, and Plaid counts those calls.
 */
export function shouldSyncBankItem(item: BankItemState): boolean {
  if (item.status === 'disconnected' || item.status === 'login_required') return false
  return item.errorCode === null || !PERMANENT_ERROR_CODES.has(item.errorCode)
}

const TRANSFER_PRIMARY_CATEGORIES = new Set(['TRANSFER_IN', 'TRANSFER_OUT'])
const TRANSFER_DETAILED_CATEGORIES = new Set(['LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'])

/** Money moving between the household's own accounts: not spending, not income. */
export function isTransferTransaction(transaction: Pick<BankTransaction, 'categoryPrimary' | 'categoryDetailed'>): boolean {
  return (
    (transaction.categoryPrimary !== null && TRANSFER_PRIMARY_CATEGORIES.has(transaction.categoryPrimary)) ||
    (transaction.categoryDetailed !== null && TRANSFER_DETAILED_CATEGORIES.has(transaction.categoryDetailed))
  )
}

/**
 * Plaid reports money out as a positive decimal. Ghar stores integer cents with money out
 * negative, so a purchase reads as a minus everywhere without a second rule.
 */
export function centsFromPlaidAmount(amount: number): Cents {
  if (!Number.isFinite(amount)) {
    throw new ValidationError('Plaid amount is not a finite number', { details: { amount } })
  }
  const cents = -Math.round(amount * 100)
  return cents === 0 ? 0 : cents
}

/**
 * A balance as Plaid reports it, in integer cents. Unlike a transaction amount the sign is kept: a
 * card or loan balance is what's owed, positive, and BALANCE_SIGN in @ghar/core/finances signs it.
 */
export function centsFromPlaidBalance(amount: number): Cents {
  if (!Number.isFinite(amount)) {
    throw new ValidationError('Plaid balance is not a finite number', { details: { amount } })
  }
  const cents = Math.round(amount * 100)
  return cents === 0 ? 0 : cents
}

export const ACCOUNT_GROUPS = ['cash', 'credit', 'loans', 'investments', 'other'] as const
export type AccountGroup = (typeof ACCOUNT_GROUPS)[number]

export function accountGroup(type: string): AccountGroup {
  switch (type) {
    case 'depository':
      return 'cash'
    case 'credit':
      return 'credit'
    case 'loan':
      return 'loans'
    case 'investment':
    case 'brokerage':
      return 'investments'
    default:
      return 'other'
  }
}
