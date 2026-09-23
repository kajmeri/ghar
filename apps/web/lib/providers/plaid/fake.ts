import 'server-only'
import type { BankAccount, BankHolding, BankLiability, BankTransaction, TransactionChanges } from '@ghar/core/banking'
import { addCalendarDays, type CalendarDate } from '@ghar/core/dates'
import { plaidError } from './plaid'
import type { PlaidClient } from './types'

// A Plaid that lives in memory, for local development and tests. It never talks to Plaid, so it never
// spends an Item. Tests drive it through the store: say what a connection holds, or make every call
// with its token fail with a Plaid error code. Locally, a token the store doesn't know gets a sample
// bank with a card, a student loan and a brokerage account.
//
// Link has no browser flow here. createLinkToken hands back a token the Money page recognizes, and
// exchangePublicToken accepts whatever it sends, so connecting a bank locally takes one click.

export interface FakePlaidItem {
  accounts: BankAccount[]
  /** Null when the institution doesn't offer Liabilities. */
  liabilities: BankLiability[] | null
  /** Null when the institution doesn't offer Investments. */
  holdings: BankHolding[] | null
  /** The connection's whole history, delivered by the first /transactions/sync. */
  transactions?: BankTransaction[]
}

export interface FakePlaidCall {
  method: 'accounts' | 'liabilities' | 'holdings' | 'transactions' | 'link_token' | 'exchange' | 'institution' | 'remove'
  accessToken: string
}

export const FAKE_INSTITUTION = { institutionId: 'ins_ghar_fake', name: 'Ghar Sample Bank' } as const

/** What the fake hands Link, and what it accepts back. Neither is secret: nothing signs them. */
export const FAKE_LINK_TOKEN = 'link-fake-ghar'
export const FAKE_PUBLIC_TOKEN = 'public-fake-ghar'

export class FakePlaidStore {
  readonly items = new Map<string, FakePlaidItem>()
  readonly failures = new Map<string, string>()
  /** Sync pages waiting per access token, oldest first. The cursor counts how many were taken. */
  readonly changes = new Map<string, TransactionChanges[]>()
  /** Access tokens handed out by exchangePublicToken, in order. */
  readonly issued: string[] = []
  /** Every call made, in order, so tests can check what was asked for. */
  readonly calls: FakePlaidCall[] = []

  put(accessToken: string, item: FakePlaidItem): void {
    this.items.set(accessToken, item)
    if (item.transactions && item.transactions.length > 0) {
      this.push(accessToken, { added: item.transactions, modified: [], removed: [] })
    }
  }

  /** Queues one more page of changes, as a later sync would find. */
  push(accessToken: string, changes: TransactionChanges): void {
    const pages = this.changes.get(accessToken) ?? []
    pages.push(changes)
    this.changes.set(accessToken, pages)
  }

  /** Every call with this token fails with Plaid's error code, like ITEM_LOGIN_REQUIRED, until recover. */
  fail(accessToken: string, errorCode: string): void {
    this.failures.set(accessToken, errorCode)
  }

  recover(accessToken: string): void {
    this.failures.delete(accessToken)
  }
}

// Kept on globalThis so "Sync now" and the cron route share one bank across hot reloads.
const globalForPlaid = globalThis as typeof globalThis & {
  gharFakePlaid?: FakePlaidStore
}

export function fakePlaidStore(): FakePlaidStore {
  globalForPlaid.gharFakePlaid ??= new FakePlaidStore()
  return globalForPlaid.gharFakePlaid
}

function account(plaidAccountId: string, name: string, type: string, subtype: string, mask: string, balanceCents: number): BankAccount {
  return {
    plaidAccountId,
    name,
    officialName: null,
    mask,
    type,
    subtype,
    currentBalanceCents: balanceCents,
    availableBalanceCents: type === 'depository' ? balanceCents : null,
    isoCurrency: 'USD',
  }
}

/** A household's spending over the past eight weeks: pay, the bills that repeat, and the rest. */
export function sampleFakePlaidTransactions(today: CalendarDate): BankTransaction[] {
  const result: BankTransaction[] = []
  const add = (
    daysAgo: number,
    account: 'fake-checking' | 'fake-card',
    name: string,
    merchantName: string | null,
    amountCents: number,
    categoryPrimary: string,
    categoryDetailed: string
  ) => {
    result.push({
      plaidTransactionId: `fake-txn-${String(result.length + 1).padStart(3, '0')}`,
      plaidAccountId: account,
      pendingTransactionId: null,
      amountCents,
      isoCurrency: 'USD',
      date: addCalendarDays(today, -daysAgo),
      authorizedDate: null,
      merchantName,
      name,
      paymentChannel: account === 'fake-card' ? 'in store' : 'other',
      categoryPrimary,
      categoryDetailed,
      categoryConfidence: 'HIGH',
      isPending: false,
    })
  }

  for (let week = 0; week < 8; week += 1) {
    const monday = week * 7
    add(monday + 2, 'fake-card', 'TRADER JOES 412 SF', 'Trader Joe’s', -8_642 - week * 137, 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES')
    add(monday + 4, 'fake-card', 'BLUE BOTTLE COFFEE', 'Blue Bottle Coffee', -675, 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_COFFEE')
    add(monday + 5, 'fake-card', 'SHELL OIL 574822', 'Shell', -4_210, 'TRANSPORTATION', 'TRANSPORTATION_GAS')
    if (week % 2 === 0) {
      add(monday + 1, 'fake-checking', 'ACME PAYROLL DIRECT DEP', 'Acme', 421_250, 'INCOME', 'INCOME_WAGES')
      add(
        monday + 6,
        'fake-card',
        'TARGET 00021453',
        'Target',
        -6_318 + week * 211,
        'GENERAL_MERCHANDISE',
        'GENERAL_MERCHANDISE_SUPERSTORES'
      )
    }
    if (week % 4 === 1) {
      add(monday + 3, 'fake-card', 'DELTA AIR 0062318871', 'Delta Air Lines', -32_400, 'TRAVEL', 'TRAVEL_FLIGHTS')
    }
  }

  add(3, 'fake-checking', 'CITY WATER UTILITY', 'City Water', -7_412, 'RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_WATER')
  add(8, 'fake-checking', 'PACIFIC GAS & ELECTRIC', 'PG&E', -14_285, 'RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY')
  add(12, 'fake-checking', 'HOME MORTGAGE PAYMENT', null, -284_000, 'LOAN_PAYMENTS', 'LOAN_PAYMENTS_MORTGAGE_PAYMENT')
  add(15, 'fake-card', 'NETFLIX.COM', 'Netflix', -2_299, 'ENTERTAINMENT', 'ENTERTAINMENT_STREAMING')
  add(18, 'fake-checking', 'PAYMENT THANK YOU - CARD', null, -150_000, 'TRANSFER_OUT', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT')
  add(21, 'fake-card', 'DR MARGARET CHEN DDS', null, -18_500, 'MEDICAL', 'MEDICAL_DENTAL_CARE')

  // Newest first is how the app reads them; the sync itself doesn't care about order.
  return result.sort((left, right) => right.date.localeCompare(left.date))
}

/** A plausible bank. Its holdings don't add up to the brokerage balance, as real ones often don't. */
export function sampleFakePlaidItem(today: CalendarDate): FakePlaidItem {
  const holding = (
    plaidSecurityId: string,
    ticker: string | null,
    name: string,
    securityType: string,
    quantity: number,
    valueCents: number,
    costBasisCents: number | null
  ): BankHolding => ({
    plaidAccountId: 'fake-brokerage',
    plaidSecurityId,
    ticker,
    name,
    securityType,
    quantity,
    costBasisCents,
    valueCents,
    asOf: addCalendarDays(today, -1),
  })
  return {
    accounts: [
      account('fake-checking', 'Everyday checking', 'depository', 'checking', '0142', 482_310),
      account('fake-savings', 'High-yield savings', 'depository', 'savings', '8830', 2_150_000),
      account('fake-card', 'Rewards card', 'credit', 'credit card', '4417', 184_233),
      account('fake-student-loan', 'Student loan', 'loan', 'student', '9021', 1_120_000),
      account('fake-brokerage', 'Brokerage', 'investment', 'brokerage', '6604', 6_420_000),
    ],
    liabilities: [
      {
        plaidAccountId: 'fake-card',
        kind: 'credit',
        aprPercent: 24.99,
        minimumPaymentCents: 4_000,
        nextPaymentDueOn: addCalendarDays(today, 12),
        lastPaymentCents: 150_000,
        lastPaymentOn: addCalendarDays(today, -18),
        originationDate: null,
        originalPrincipalCents: null,
        isOverdue: false,
      },
      {
        plaidAccountId: 'fake-student-loan',
        kind: 'student',
        aprPercent: 5.5,
        minimumPaymentCents: 21_700,
        nextPaymentDueOn: addCalendarDays(today, 20),
        lastPaymentCents: 21_700,
        lastPaymentOn: addCalendarDays(today, -10),
        originationDate: '2019-08-15',
        originalPrincipalCents: 3_200_000,
        isOverdue: false,
      },
    ],
    holdings: [
      holding('fake-vti', 'VTI', 'Vanguard Total Stock Market ETF', 'etf', 142, 3_905_000, 2_870_000),
      holding('fake-vxus', 'VXUS', 'Vanguard Total International Stock ETF', 'etf', 180, 1_152_000, 1_080_000),
      holding('fake-bnd', 'BND', 'Vanguard Total Bond Market ETF', 'etf', 88, 640_200, 668_800),
      holding('fake-aapl', 'AAPL', 'Apple Inc.', 'equity', 20, 458_000, null),
      holding('fake-cash', null, 'Cash sweep', 'cash', 251_300, 251_300, 251_300),
    ],
    transactions: sampleFakePlaidTransactions(today),
  }
}

/** Codes that mean the Item is already gone, so removing it is nothing to complain about. */
const GONE_ERROR_CODES = new Set(['ITEM_NOT_FOUND', 'INVALID_ACCESS_TOKEN', 'USER_PERMISSION_REVOKED'])

const LIABILITY_ACCOUNT_TYPES = new Set(['credit', 'loan'])
const INVESTMENT_ACCOUNT_TYPES = new Set(['investment', 'brokerage'])

function settle<T>(work: () => T): Promise<T> {
  try {
    return Promise.resolve(work())
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)))
  }
}

export function createFakePlaidClient(options: { store?: FakePlaidStore; now?: () => Date; seed?: boolean } = {}): PlaidClient {
  const store = options.store ?? fakePlaidStore()
  const now = options.now ?? (() => new Date())
  const seed = options.seed ?? true

  function itemFor(method: FakePlaidCall['method'], accessToken: string): FakePlaidItem {
    store.calls.push({ method, accessToken })
    const failure = store.failures.get(accessToken)
    if (failure !== undefined) throw plaidError(400, { error_type: 'ITEM_ERROR', error_code: failure })
    let item = store.items.get(accessToken)
    if (!item && seed) {
      item = sampleFakePlaidItem(now().toISOString().slice(0, 10))
      store.put(accessToken, item)
    }
    if (!item) throw plaidError(400, { error_type: 'INVALID_INPUT', error_code: 'INVALID_ACCESS_TOKEN' })
    return item
  }

  function unavailable(errorCode: string): Error {
    return plaidError(400, { error_type: 'ITEM_ERROR', error_code: errorCode })
  }

  /** `fake-cursor-<pages taken>`. A cursor from another provider is refused, as Plaid's would be. */
  function cursorPosition(cursor: string | null): number {
    if (cursor === null) return 0
    const match = /^fake-cursor-(\d+)$/.exec(cursor)
    if (!match?.[1]) throw plaidError(400, { error_type: 'INVALID_INPUT', error_code: 'INVALID_FIELD' })
    return Number(match[1])
  }

  return {
    createLinkToken(request) {
      return settle(() => {
        store.calls.push({ method: 'link_token', accessToken: request.accessToken ?? '' })
        // Update mode still checks the connection is one this store knows about.
        if (request.accessToken !== undefined) itemFor('link_token', request.accessToken)
        return { token: FAKE_LINK_TOKEN, expiresAt: new Date(now().getTime() + 30 * 60 * 1000) }
      })
    },

    exchangePublicToken(publicToken) {
      return settle(() => {
        store.calls.push({ method: 'exchange', accessToken: publicToken })
        const n = store.issued.length + 1
        const accessToken = `access-fake-${String(n)}`
        store.issued.push(accessToken)
        return { accessToken, plaidItemId: `item-fake-${String(n)}` }
      })
    },

    getInstitution(accessToken) {
      return settle(() => {
        itemFor('institution', accessToken)
        return { ...FAKE_INSTITUTION }
      })
    },

    getAccounts(accessToken) {
      return settle(() => structuredClone(itemFor('accounts', accessToken).accounts))
    },

    getLiabilities(accessToken) {
      return settle(() => {
        const item = itemFor('liabilities', accessToken)
        if (item.liabilities === null) throw unavailable('PRODUCTS_NOT_SUPPORTED')
        if (!item.accounts.some(entry => LIABILITY_ACCOUNT_TYPES.has(entry.type))) throw unavailable('NO_LIABILITY_ACCOUNTS')
        return structuredClone({ accounts: item.accounts, liabilities: item.liabilities })
      })
    },

    getHoldings(accessToken) {
      return settle(() => {
        const item = itemFor('holdings', accessToken)
        if (item.holdings === null) throw unavailable('PRODUCTS_NOT_SUPPORTED')
        if (!item.accounts.some(entry => INVESTMENT_ACCOUNT_TYPES.has(entry.type))) throw unavailable('NO_INVESTMENT_ACCOUNTS')
        return structuredClone({ accounts: item.accounts, holdings: item.holdings })
      })
    },

    syncTransactions(accessToken, cursor) {
      return settle(() => {
        const item = itemFor('transactions', accessToken)
        const taken = cursorPosition(cursor)
        const queued = store.changes.get(accessToken) ?? []
        return structuredClone({
          accounts: item.accounts,
          pages: queued.slice(taken),
          nextCursor: `fake-cursor-${String(queued.length)}`,
          hasMore: false,
        })
      })
    },

    removeItem(accessToken) {
      return settle(() => {
        store.calls.push({ method: 'remove', accessToken })
        const failure = store.failures.get(accessToken)
        // A token the fake still refuses fails here too, unless the refusal is that it is already gone.
        if (failure !== undefined && !GONE_ERROR_CODES.has(failure)) {
          throw plaidError(400, { error_type: 'ITEM_ERROR', error_code: failure })
        }
        store.items.delete(accessToken)
        store.changes.delete(accessToken)
        store.failures.delete(accessToken)
      })
    },

    verifyWebhook() {
      // A fake connection only exists where there are no Plaid keys, so there is no real signature
      // to check. The route still refuses webhooks for connections it doesn't know.
      return Promise.resolve(true)
    },
  }
}
