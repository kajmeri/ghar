import type {
  BankAccount,
  BankHolding,
  BankInstitution,
  BankItemCredentials,
  BankLinkToken,
  BankLiability,
  BankTransactionSync,
} from '@ghar/core/banking'

// What connecting a bank and the daily sync need from Plaid, in domain shapes. Balances come from
// /accounts/get, which is free and returns what Plaid last fetched from the bank: about daily for a
// connection with Transactions, Liabilities or Investments. /accounts/balance/get would ask the bank
// live, and Plaid bills every call.

/** What Link needs to open. Leaving `accessToken` out asks for a new connection. */
export interface LinkTokenRequest {
  /**
   * Plaid's client_user_id. Stable per household, and never an email or anything else about a
   * person: Plaid stores it.
   */
  userRef: string
  /** Where Plaid posts webhooks, or null when this deployment has no public URL. */
  webhookUrl: string | null
  /** Update mode: reopens an existing connection to repair it, instead of making another Item. */
  accessToken?: string
}

export interface PlaidClient {
  /** A token for opening Link in the browser. */
  createLinkToken(request: LinkTokenRequest): Promise<BankLinkToken>
  /** Trades the public token Link hands back for the lasting access token. */
  exchangePublicToken(publicToken: string): Promise<BankItemCredentials>
  /** Which bank the connection is with. Its own failures are swallowed: the name is decoration. */
  getInstitution(accessToken: string): Promise<BankInstitution>
  /** Every account on the connection, with its balance as Plaid last saw it. */
  getAccounts(accessToken: string): Promise<BankAccount[]>
  /**
   * APR, payments and origination for credit cards, student loans and mortgages. Throws
   * PlaidProductUnavailableError when the connection has none Plaid covers.
   */
  getLiabilities(accessToken: string): Promise<{ accounts: BankAccount[]; liabilities: BankLiability[] }>
  /** Positions in investment accounts. Throws PlaidProductUnavailableError when there are none. */
  getHoldings(accessToken: string): Promise<{ accounts: BankAccount[]; holdings: BankHolding[] }>
  /**
   * Everything that changed since `cursor`, following Plaid's pages until they run out or the run
   * hits its page cap. A null cursor asks for the connection's whole history.
   */
  syncTransactions(accessToken: string, cursor: string | null): Promise<BankTransactionSync>
  /**
   * Revokes the access token at Plaid, so nothing can read the bank with it again. An Item already
   * gone counts as removed. The Item slot is not given back: Plaid's lifetime allowance has spent it.
   */
  removeItem(accessToken: string): Promise<void>
  /** Whether the JWT in Plaid's `plaid-verification` header signs exactly this request body. */
  verifyWebhook(input: { body: string; jwt: string; now?: Date }): Promise<boolean>
}

// Error messages are ours and safe to store or show. None include a token, a secret or Plaid's
// response body. Codes are Plaid's error_code, checked to be a plain identifier before use.

/**
 * Plaid says the connection itself needs attention: ITEM_LOGIN_REQUIRED, INSTITUTION_DOWN,
 * ITEM_NOT_FOUND and the like. bankItemStatusForError in @ghar/core/banking says what it means.
 */
export class PlaidItemError extends Error {
  override readonly name = 'PlaidItemError'
  constructor(readonly code: string) {
    super(`Plaid reported ${code} for this connection.`)
  }
}

/**
 * The connection has nothing of this kind: no card or loan Plaid covers, no investment account, or
 * the person didn't consent to share it. Nothing is wrong with the connection.
 */
export class PlaidProductUnavailableError extends Error {
  override readonly name = 'PlaidProductUnavailableError'
  constructor(readonly code: string) {
    super(`Plaid has no data of this kind for this connection (${code}).`)
  }
}

/** Anything else: Plaid was down, slow, rate limiting, not ready, or sent something unexpected. Retry later. */
export class PlaidProviderError extends Error {
  override readonly name = 'PlaidProviderError'
}
