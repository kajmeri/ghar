import 'server-only'
import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto'
import {
  centsFromPlaidAmount,
  centsFromPlaidBalance,
  type BankAccount,
  type BankHolding,
  type BankLiability,
  type BankTransaction,
  type TransactionChanges,
} from '@ghar/core/banking'
import { isCalendarDate, type CalendarDate } from '@ghar/core/dates'
import { z } from 'zod'
import { PlaidItemError, PlaidProductUnavailableError, PlaidProviderError, type PlaidClient } from './types'

// Plaid over plain fetch. The client ID, secret and access token travel only in JSON request bodies,
// never in URLs, logs or errors. Every response is checked with zod and turned into
// @ghar/core/banking shapes here, so nothing else sees Plaid's.

const HOSTS = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
} as const

export type PlaidEnvironment = keyof typeof HOSTS

/** Pinned, so a Plaid release can't change a response shape under us. */
const PLAID_VERSION = '2020-09-14'

const accountSchema = z.object({
  account_id: z.string().min(1),
  name: z.string(),
  official_name: z.string().nullish(),
  mask: z.string().nullish(),
  type: z.string().min(1),
  subtype: z.string().nullish(),
  balances: z.object({
    current: z.number().nullish(),
    available: z.number().nullish(),
    iso_currency_code: z.string().nullish(),
    unofficial_currency_code: z.string().nullish(),
  }),
})

const accountsResponseSchema = z.object({ accounts: z.array(accountSchema) })

const creditSchema = z.object({
  account_id: z.string().nullish(),
  aprs: z.array(z.object({ apr_percentage: z.number().nullish(), apr_type: z.string().nullish() })).nullish(),
  is_overdue: z.boolean().nullish(),
  last_payment_amount: z.number().nullish(),
  last_payment_date: z.string().nullish(),
  minimum_payment_amount: z.number().nullish(),
  next_payment_due_date: z.string().nullish(),
})

const studentSchema = z.object({
  account_id: z.string().nullish(),
  interest_rate_percentage: z.number().nullish(),
  is_overdue: z.boolean().nullish(),
  last_payment_amount: z.number().nullish(),
  last_payment_date: z.string().nullish(),
  minimum_payment_amount: z.number().nullish(),
  next_payment_due_date: z.string().nullish(),
  origination_date: z.string().nullish(),
  origination_principal_amount: z.number().nullish(),
})

const mortgageSchema = z.object({
  account_id: z.string().nullish(),
  interest_rate: z.object({ percentage: z.number().nullish() }).nullish(),
  last_payment_amount: z.number().nullish(),
  last_payment_date: z.string().nullish(),
  next_monthly_payment: z.number().nullish(),
  next_payment_due_date: z.string().nullish(),
  origination_date: z.string().nullish(),
  origination_principal_amount: z.number().nullish(),
  past_due_amount: z.number().nullish(),
})

const liabilitiesSchema = z.object({
  credit: z.array(creditSchema).nullish(),
  student: z.array(studentSchema).nullish(),
  mortgage: z.array(mortgageSchema).nullish(),
})

const liabilitiesResponseSchema = z.object({ accounts: z.array(accountSchema), liabilities: liabilitiesSchema })

const holdingSchema = z.object({
  account_id: z.string().min(1),
  security_id: z.string().min(1),
  institution_value: z.number(),
  /** The whole position's cost, not per share. */
  cost_basis: z.number().nullish(),
  quantity: z.number(),
  institution_price_as_of: z.string().nullish(),
  institution_price_datetime: z.string().nullish(),
})

const securitySchema = z.object({
  security_id: z.string().min(1),
  ticker_symbol: z.string().nullish(),
  name: z.string().nullish(),
  type: z.string().nullish(),
})

const holdingsResponseSchema = z.object({
  accounts: z.array(accountSchema),
  holdings: z.array(holdingSchema),
  securities: z.array(securitySchema),
})

const linkTokenResponseSchema = z.object({ link_token: z.string().min(1), expiration: z.string().min(1) })

const exchangeResponseSchema = z.object({ access_token: z.string().min(1), item_id: z.string().min(1) })

const removeResponseSchema = z.object({ request_id: z.string().min(1) })

const itemResponseSchema = z.object({ item: z.object({ item_id: z.string().min(1), institution_id: z.string().nullish() }) })

const institutionResponseSchema = z.object({ institution: z.object({ institution_id: z.string().min(1), name: z.string().nullish() }) })

const transactionSchema = z.object({
  transaction_id: z.string().min(1),
  account_id: z.string().min(1),
  pending_transaction_id: z.string().nullish(),
  amount: z.number(),
  iso_currency_code: z.string().nullish(),
  unofficial_currency_code: z.string().nullish(),
  date: z.string(),
  authorized_date: z.string().nullish(),
  merchant_name: z.string().nullish(),
  name: z.string(),
  payment_channel: z.string().nullish(),
  personal_finance_category: z
    .object({
      primary: z.string().nullish(),
      detailed: z.string().nullish(),
      confidence_level: z.string().nullish(),
    })
    .nullish(),
  pending: z.boolean().nullish(),
})

const syncResponseSchema = z.object({
  accounts: z.array(accountSchema),
  added: z.array(transactionSchema),
  modified: z.array(transactionSchema),
  removed: z.array(z.object({ transaction_id: z.string().min(1) })),
  next_cursor: z.string(),
  has_more: z.boolean(),
})

/** A JWK for verifying webhook signatures, as /webhook_verification_key/get returns it. */
const verificationKeyResponseSchema = z.object({
  key: z.object({
    alg: z.literal('ES256'),
    crv: z.string().min(1),
    kty: z.literal('EC'),
    x: z.string().min(1),
    y: z.string().min(1),
    /** Set once Plaid retires the key. One that expired before the webhook was sent is refused. */
    expired_at: z.number().nullish(),
  }),
})

const errorSchema = z.object({ error_type: z.string(), error_code: z.string() })

type PlaidAccount = z.infer<typeof accountSchema>
type PlaidLiabilities = z.infer<typeof liabilitiesSchema>
type PlaidHolding = z.infer<typeof holdingSchema>
type PlaidSecurity = z.infer<typeof securitySchema>
type PlaidTransaction = z.infer<typeof transactionSchema>

function centsOrNull(amount: number | null | undefined): number | null {
  return amount === null || amount === undefined ? null : centsFromPlaidBalance(amount)
}

/** Payments and principal are never negative; a stray negative from an institution reads as zero. */
function owedCents(amount: number | null | undefined): number | null {
  const cents = centsOrNull(amount)
  return cents === null ? null : Math.max(0, cents)
}

function dateOrNull(value: string | null | undefined): CalendarDate | null {
  return value !== null && value !== undefined && isCalendarDate(value) ? value : null
}

export function toBankAccount(account: PlaidAccount): BankAccount {
  return {
    plaidAccountId: account.account_id,
    name: account.name,
    officialName: account.official_name ?? null,
    mask: account.mask ?? null,
    type: account.type,
    subtype: account.subtype ?? null,
    // Kept as reported: a card or loan's positive balance is what's owed, signed later by BALANCE_SIGN.
    currentBalanceCents: centsOrNull(account.balances.current),
    availableBalanceCents: centsOrNull(account.balances.available),
    isoCurrency: account.balances.iso_currency_code ?? account.balances.unofficial_currency_code ?? null,
  }
}

export function toBankLiabilities(liabilities: PlaidLiabilities): BankLiability[] {
  const result: BankLiability[] = []
  for (const card of liabilities.credit ?? []) {
    if (!card.account_id) continue
    const aprs = card.aprs ?? []
    // A card can carry several APRs. The purchase APR is the one a balance usually accrues at.
    const apr = aprs.find(entry => entry.apr_type === 'purchase_apr') ?? aprs[0]
    result.push({
      plaidAccountId: card.account_id,
      kind: 'credit',
      aprPercent: apr?.apr_percentage ?? null,
      minimumPaymentCents: owedCents(card.minimum_payment_amount),
      nextPaymentDueOn: dateOrNull(card.next_payment_due_date),
      lastPaymentCents: owedCents(card.last_payment_amount),
      lastPaymentOn: dateOrNull(card.last_payment_date),
      originationDate: null,
      originalPrincipalCents: null,
      isOverdue: card.is_overdue ?? false,
    })
  }
  for (const loan of liabilities.student ?? []) {
    if (!loan.account_id) continue
    result.push({
      plaidAccountId: loan.account_id,
      kind: 'student',
      aprPercent: loan.interest_rate_percentage ?? null,
      minimumPaymentCents: owedCents(loan.minimum_payment_amount),
      nextPaymentDueOn: dateOrNull(loan.next_payment_due_date),
      lastPaymentCents: owedCents(loan.last_payment_amount),
      lastPaymentOn: dateOrNull(loan.last_payment_date),
      originationDate: dateOrNull(loan.origination_date),
      originalPrincipalCents: owedCents(loan.origination_principal_amount),
      isOverdue: loan.is_overdue ?? false,
    })
  }
  for (const mortgage of liabilities.mortgage ?? []) {
    if (!mortgage.account_id) continue
    result.push({
      plaidAccountId: mortgage.account_id,
      kind: 'mortgage',
      aprPercent: mortgage.interest_rate?.percentage ?? null,
      // A mortgage has no minimum: the monthly payment is the payment.
      minimumPaymentCents: owedCents(mortgage.next_monthly_payment),
      nextPaymentDueOn: dateOrNull(mortgage.next_payment_due_date),
      lastPaymentCents: owedCents(mortgage.last_payment_amount),
      lastPaymentOn: dateOrNull(mortgage.last_payment_date),
      originationDate: dateOrNull(mortgage.origination_date),
      originalPrincipalCents: owedCents(mortgage.origination_principal_amount),
      isOverdue: (mortgage.past_due_amount ?? 0) > 0,
    })
  }
  return result
}

/** `today` dates a position whose institution didn't say when it priced it. */
export function toBankHoldings(
  holdings: readonly PlaidHolding[],
  securities: readonly PlaidSecurity[],
  today: CalendarDate
): BankHolding[] {
  const bySecurity = new Map(securities.map(security => [security.security_id, security]))
  return holdings.map(holding => {
    const security = bySecurity.get(holding.security_id)
    return {
      plaidAccountId: holding.account_id,
      plaidSecurityId: holding.security_id,
      ticker: security?.ticker_symbol ?? null,
      name: security?.name ?? null,
      securityType: security?.type ?? null,
      quantity: holding.quantity,
      costBasisCents: centsOrNull(holding.cost_basis),
      valueCents: centsFromPlaidBalance(holding.institution_value),
      asOf: dateOrNull(holding.institution_price_as_of) ?? dateOrNull(holding.institution_price_datetime?.slice(0, 10)) ?? today,
    }
  })
}

export function toBankTransaction(transaction: PlaidTransaction): BankTransaction {
  const date = dateOrNull(transaction.date)
  if (date === null) {
    throw new PlaidProviderError('Plaid sent a transaction without a usable date.')
  }
  return {
    plaidTransactionId: transaction.transaction_id,
    plaidAccountId: transaction.account_id,
    pendingTransactionId: transaction.pending_transaction_id ?? null,
    // Plaid reports money out as positive; centsFromPlaidAmount flips it.
    amountCents: centsFromPlaidAmount(transaction.amount),
    isoCurrency: transaction.iso_currency_code ?? transaction.unofficial_currency_code ?? null,
    date,
    authorizedDate: dateOrNull(transaction.authorized_date),
    merchantName: transaction.merchant_name ?? null,
    name: transaction.name,
    paymentChannel: transaction.payment_channel ?? null,
    categoryPrimary: transaction.personal_finance_category?.primary ?? null,
    categoryDetailed: transaction.personal_finance_category?.detailed ?? null,
    categoryConfidence: transaction.personal_finance_category?.confidence_level ?? null,
    isPending: transaction.pending ?? false,
  }
}

/** Nothing to sync, and nothing wrong with the connection. */
const PRODUCT_UNAVAILABLE_CODES = new Set([
  'PRODUCTS_NOT_SUPPORTED',
  'NO_LIABILITY_ACCOUNTS',
  'NO_INVESTMENT_ACCOUNTS',
  // The person didn't share this kind of data in Link. An INVALID_INPUT error, not an ITEM_ERROR.
  'ADDITIONAL_CONSENT_REQUIRED',
])

/** Item errors that clear up without anyone doing anything. */
const RETRY_LATER_CODES = new Set(['PRODUCT_NOT_READY'])

const ITEM_ERROR_TYPES = new Set(['ITEM_ERROR', 'INSTITUTION_ERROR'])

/** Not ITEM_ERRORs by type, but they're about the connection: its token no longer works. */
const ITEM_INPUT_CODES = new Set(['INVALID_ACCESS_TOKEN'])

/** The Item is already gone at Plaid. Removing it again has nothing left to do. */
const GONE_ERROR_CODES = new Set(['ITEM_NOT_FOUND', 'INVALID_ACCESS_TOKEN', 'USER_PERMISSION_REVOKED'])

const ERROR_CODE = /^[A-Z0-9_]{1,64}$/

/** Plaid's error body to one of our errors. Only a code that looks like one is ever kept. */
export function plaidError(status: number, body: unknown): Error {
  const parsed = errorSchema.safeParse(body)
  if (!parsed.success || !ERROR_CODE.test(parsed.data.error_code)) {
    return new PlaidProviderError(`Plaid answered ${String(status)}. The next sync will retry.`)
  }
  const { error_type: type, error_code: code } = parsed.data
  if (PRODUCT_UNAVAILABLE_CODES.has(code)) return new PlaidProductUnavailableError(code)
  if (RETRY_LATER_CODES.has(code)) {
    return new PlaidProviderError(`Plaid isn’t ready with this data yet (${code}). The next sync will retry.`)
  }
  if (ITEM_ERROR_TYPES.has(type) || ITEM_INPUT_CODES.has(code)) return new PlaidItemError(code)
  return new PlaidProviderError(`Plaid refused the request (${code}). The next sync will retry.`)
}

export interface PlaidOptions {
  clientId: string
  secret: string
  environment: PlaidEnvironment
  /** Shown to the person inside Link, above their bank's sign-in form. */
  clientName?: string
  fetch?: typeof fetch
  timeoutMs?: number
  now?: () => Date
}

/** How far back a new connection asks for. Plaid's maximum is 730 days. */
const TRANSACTION_DAYS_REQUESTED = 730

/**
 * Pages of /transactions/sync one run will follow. A first sync of a busy account can run longer
 * than a request should, so the rest waits for the next sync, which starts from the new cursor.
 */
const MAX_SYNC_PAGES = 50

/** A webhook signed longer ago than this is refused, however good its signature. */
const WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000

const jwtHeaderSchema = z.object({ alg: z.string(), kid: z.string().min(1) })
const jwtClaimsSchema = z.object({ iat: z.number(), request_body_sha256: z.string().min(1) })

function base64UrlToBuffer(value: string): Buffer {
  return Buffer.from(value, 'base64url')
}

function decodeJwtPart<S extends z.ZodType>(part: string | undefined, schema: S): z.output<S> | null {
  if (!part) return null
  try {
    const parsed = schema.safeParse(JSON.parse(base64UrlToBuffer(part).toString('utf8')) as unknown)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function createPlaidClient(options: PlaidOptions): PlaidClient {
  const fetchImpl = options.fetch ?? fetch
  // Plaid's product endpoints can take a while when an institution is slow.
  const timeoutMs = options.timeoutMs ?? 30_000
  const now = options.now ?? (() => new Date())

  async function readJson(response: Response): Promise<unknown> {
    try {
      return (await response.json()) as unknown
    } catch {
      return null
    }
  }

  async function post<S extends z.ZodType>(path: string, payload: Record<string, unknown>, schema: S): Promise<z.output<S>> {
    let response: Response
    try {
      response = await fetchImpl(`${HOSTS[options.environment]}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'plaid-version': PLAID_VERSION },
        body: JSON.stringify({ client_id: options.clientId, secret: options.secret, ...payload }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      throw new PlaidProviderError('Plaid didn’t respond. The next sync will retry.')
    }
    const body = await readJson(response)
    if (!response.ok) throw plaidError(response.status, body)
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      throw new PlaidProviderError('Plaid sent a response Ghar couldn’t read.')
    }
    return parsed.data
  }

  // Verification keys are immutable per kid, so one fetch each is enough for this client's life.
  const verificationKeys = new Map<string, Promise<z.output<typeof verificationKeyResponseSchema>>>()

  function verificationKey(keyId: string): Promise<z.output<typeof verificationKeyResponseSchema>> {
    const cached = verificationKeys.get(keyId)
    if (cached) return cached
    const pending = post('/webhook_verification_key/get', { key_id: keyId }, verificationKeyResponseSchema)
    verificationKeys.set(keyId, pending)
    // A failed fetch shouldn't be remembered as the answer.
    pending.catch(() => verificationKeys.delete(keyId))
    return pending
  }

  return {
    async createLinkToken({ userRef, webhookUrl, accessToken }) {
      const body = await post(
        '/link/token/create',
        {
          client_name: options.clientName ?? 'Ghar',
          language: 'en',
          country_codes: ['US'],
          user: { client_user_id: userRef },
          ...(webhookUrl === null ? {} : { webhook: webhookUrl }),
          // Update mode repairs the connection it is given, so it names no products.
          ...(accessToken === undefined
            ? { products: ['transactions'], transactions: { days_requested: TRANSACTION_DAYS_REQUESTED } }
            : { access_token: accessToken }),
        },
        linkTokenResponseSchema
      )
      const expiresAt = new Date(body.expiration)
      if (Number.isNaN(expiresAt.getTime())) {
        throw new PlaidProviderError('Plaid sent a link token without a usable expiry.')
      }
      return { token: body.link_token, expiresAt }
    },

    async exchangePublicToken(publicToken) {
      const body = await post('/item/public_token/exchange', { public_token: publicToken }, exchangeResponseSchema)
      return { accessToken: body.access_token, plaidItemId: body.item_id }
    },

    async removeItem(accessToken) {
      try {
        await post('/item/remove', { access_token: accessToken }, removeResponseSchema)
      } catch (error) {
        // An Item Plaid no longer has is an Item nobody can read the bank with. That is the point.
        if (error instanceof PlaidItemError && GONE_ERROR_CODES.has(error.code)) return
        throw error
      }
    },

    async getInstitution(accessToken) {
      const item = await post('/item/get', { access_token: accessToken }, itemResponseSchema)
      const institutionId = item.item.institution_id ?? null
      if (institutionId === null) return { institutionId: null, name: null }
      try {
        const body = await post(
          '/institutions/get_by_id',
          { institution_id: institutionId, country_codes: ['US'] },
          institutionResponseSchema
        )
        return { institutionId, name: body.institution.name ?? null }
      } catch {
        // The name is decoration. A connection without one is still worth keeping.
        return { institutionId, name: null }
      }
    },

    async getAccounts(accessToken) {
      const body = await post('/accounts/get', { access_token: accessToken }, accountsResponseSchema)
      return body.accounts.map(toBankAccount)
    },

    async getLiabilities(accessToken) {
      const body = await post('/liabilities/get', { access_token: accessToken }, liabilitiesResponseSchema)
      return { accounts: body.accounts.map(toBankAccount), liabilities: toBankLiabilities(body.liabilities) }
    },

    async getHoldings(accessToken) {
      const body = await post('/investments/holdings/get', { access_token: accessToken }, holdingsResponseSchema)
      return {
        accounts: body.accounts.map(toBankAccount),
        holdings: toBankHoldings(body.holdings, body.securities, now().toISOString().slice(0, 10)),
      }
    },

    async syncTransactions(accessToken, cursor) {
      const pages: TransactionChanges[] = []
      let accounts: BankAccount[] = []
      let nextCursor = cursor
      let hasMore = true
      let fetched = 0

      while (hasMore && fetched < MAX_SYNC_PAGES) {
        const body = await post(
          '/transactions/sync',
          {
            access_token: accessToken,
            // Plaid rejects an explicit null, so a first sync leaves the cursor out entirely.
            ...(nextCursor === null ? {} : { cursor: nextCursor }),
            options: { include_original_description: false },
          },
          syncResponseSchema
        )
        fetched += 1
        accounts = body.accounts.map(toBankAccount)
        pages.push({
          added: body.added.map(toBankTransaction),
          modified: body.modified.map(toBankTransaction),
          removed: body.removed.map(entry => entry.transaction_id),
        })
        nextCursor = body.next_cursor
        hasMore = body.has_more
      }

      if (nextCursor === null) {
        throw new PlaidProviderError('Plaid sent no cursor for this connection.')
      }
      return { accounts, pages, nextCursor, hasMore }
    },

    async verifyWebhook({ body, jwt, now: at }) {
      const [headerPart, claimsPart, signaturePart] = jwt.split('.')
      if (!headerPart || !claimsPart || !signaturePart) return false

      const header = decodeJwtPart(headerPart, jwtHeaderSchema)
      // Plaid signs with ES256. Anything else, including "none", is refused outright.
      if (!header || header.alg !== 'ES256') return false

      let key
      try {
        key = (await verificationKey(header.kid)).key
      } catch {
        return false
      }
      if (key.expired_at !== null && key.expired_at !== undefined) return false

      let signed: boolean
      try {
        const publicKey = createPublicKey({ key: { kty: key.kty, crv: key.crv, x: key.x, y: key.y }, format: 'jwk' })
        signed = verifySignature(
          'sha256',
          Buffer.from(`${headerPart}.${claimsPart}`),
          // A JWS signature is raw r||s, not the DER encoding node verifies by default.
          { key: publicKey, dsaEncoding: 'ieee-p1363' },
          base64UrlToBuffer(signaturePart)
        )
      } catch {
        return false
      }
      if (!signed) return false

      const claims = decodeJwtPart(claimsPart, jwtClaimsSchema)
      if (!claims) return false
      // A signature stays valid forever, so an old one being replayed is refused on its age.
      const age = (at ?? now()).getTime() - claims.iat * 1000
      if (!Number.isFinite(age) || age > WEBHOOK_MAX_AGE_MS || age < -WEBHOOK_MAX_AGE_MS) return false

      return createHash('sha256').update(body, 'utf8').digest('hex') === claims.request_body_sha256
    },
  }
}
