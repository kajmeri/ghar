import { describe, expect, it } from 'vitest'
import { createPlaidClient, plaidError } from '@/lib/providers/plaid/plaid'
import { PlaidItemError, PlaidProductUnavailableError, PlaidProviderError } from '@/lib/providers/plaid/types'

// The Plaid client against a stand-in fetch: what it sends, how it reads Plaid's shapes, and what
// each failure becomes. Nothing here reaches Plaid.

const NOW = new Date('2026-09-14T15:00:00Z')
const ACCESS_TOKEN = 'access-sandbox-5c1a0f7e'
const SECRET = 'plaid-secret-9d2b'

interface Sent {
  url: string
  headers: Record<string, string>
  body: unknown
}

function plaid(respond: (url: string) => Response | Promise<Response>) {
  const sent: Sent[] = []
  const fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    sent.push({
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(typeof init?.body === 'string' ? init.body : 'null') as unknown,
    })
    return Promise.resolve(respond(url))
  }
  const client = createPlaidClient({ clientId: 'client-1', secret: SECRET, environment: 'sandbox', fetch, now: () => NOW })
  return { client, sent }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function plaidAccount(overrides: Record<string, unknown> = {}) {
  return {
    account_id: 'acct-checking',
    name: 'Plaid Checking',
    official_name: 'Plaid Gold Standard 0% Interest Checking',
    mask: '0000',
    type: 'depository',
    subtype: 'checking',
    balances: { available: 100, current: 110.94, limit: null, iso_currency_code: 'USD', unofficial_currency_code: null },
    ...overrides,
  }
}

describe('Plaid client requests', () => {
  it('sends the keys and access token only in the JSON body, to the environment it was made for', async () => {
    const { client, sent } = plaid(() => json({ accounts: [], item: {}, request_id: 'r1' }))

    await client.getAccounts(ACCESS_TOKEN)

    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe('https://sandbox.plaid.com/accounts/get')
    expect(sent[0]?.url).not.toContain(ACCESS_TOKEN)
    expect(sent[0]?.headers['content-type']).toBe('application/json')
    expect(sent[0]?.headers['plaid-version']).toBe('2020-09-14')
    expect(sent[0]?.body).toEqual({ client_id: 'client-1', secret: SECRET, access_token: ACCESS_TOKEN })
  })

  it('asks /liabilities/get and /investments/holdings/get for the product calls', async () => {
    const { client, sent } = plaid(url =>
      url.endsWith('/liabilities/get')
        ? json({ accounts: [], liabilities: { credit: null, mortgage: null, student: null } })
        : json({ accounts: [], holdings: [], securities: [] })
    )

    await client.getLiabilities(ACCESS_TOKEN)
    await client.getHoldings(ACCESS_TOKEN)

    expect(sent.map(request => request.url)).toEqual([
      'https://sandbox.plaid.com/liabilities/get',
      'https://sandbox.plaid.com/investments/holdings/get',
    ])
  })
})

describe('Plaid accounts', () => {
  it('keeps balances as Plaid reports them, so an amount owed stays positive until the snapshot signs it', async () => {
    const { client } = plaid(() =>
      json({
        accounts: [
          plaidAccount(),
          plaidAccount({
            account_id: 'acct-card',
            name: 'Plaid Credit Card',
            official_name: null,
            mask: null,
            type: 'credit',
            subtype: 'credit card',
            balances: { available: null, current: 410.1, limit: 2000, iso_currency_code: 'USD', unofficial_currency_code: null },
          }),
          plaidAccount({
            account_id: 'acct-overpaid',
            type: 'credit',
            subtype: 'credit card',
            // The lender owes the household: Plaid reports it negative.
            balances: { available: null, current: -12.5, iso_currency_code: null, unofficial_currency_code: 'USDC' },
          }),
        ],
      })
    )

    const accounts = await client.getAccounts(ACCESS_TOKEN)

    expect(accounts).toEqual([
      {
        plaidAccountId: 'acct-checking',
        name: 'Plaid Checking',
        officialName: 'Plaid Gold Standard 0% Interest Checking',
        mask: '0000',
        type: 'depository',
        subtype: 'checking',
        currentBalanceCents: 11_094,
        availableBalanceCents: 10_000,
        isoCurrency: 'USD',
      },
      {
        plaidAccountId: 'acct-card',
        name: 'Plaid Credit Card',
        officialName: null,
        mask: null,
        type: 'credit',
        subtype: 'credit card',
        currentBalanceCents: 41_010,
        availableBalanceCents: null,
        isoCurrency: 'USD',
      },
      expect.objectContaining({ plaidAccountId: 'acct-overpaid', currentBalanceCents: -1_250, isoCurrency: 'USDC' }),
    ])
  })

  it('reads a balance the bank didn’t report as unknown, not zero', async () => {
    const { client } = plaid(() =>
      json({ accounts: [plaidAccount({ balances: { available: null, current: null, iso_currency_code: 'USD' } })] })
    )

    const [account] = await client.getAccounts(ACCESS_TOKEN)

    expect(account?.currentBalanceCents).toBeNull()
    expect(account?.availableBalanceCents).toBeNull()
  })
})

describe('Plaid liabilities', () => {
  it('maps cards, student loans and mortgages to one shape', async () => {
    const { client } = plaid(() =>
      json({
        accounts: [plaidAccount({ account_id: 'acct-card', type: 'credit' })],
        liabilities: {
          credit: [
            {
              account_id: 'acct-card',
              aprs: [
                { apr_percentage: 29.99, apr_type: 'cash_apr', balance_subject_to_apr: null, interest_charge_amount: null },
                { apr_percentage: 22.49, apr_type: 'purchase_apr', balance_subject_to_apr: 1562.32, interest_charge_amount: 130.22 },
              ],
              is_overdue: null,
              last_payment_amount: 168.25,
              last_payment_date: 'not a date',
              last_statement_issue_date: '2026-09-01',
              last_statement_balance: 1708.77,
              minimum_payment_amount: 20,
              next_payment_due_date: '2026-10-01',
            },
          ],
          student: [
            {
              account_id: 'acct-student',
              interest_rate_percentage: 5.25,
              is_overdue: false,
              // A refund from the servicer: a payment is never negative.
              last_payment_amount: -10,
              last_payment_date: '2026-08-25',
              minimum_payment_amount: 25,
              next_payment_due_date: '2026-09-25',
              origination_date: '2019-08-01',
              origination_principal_amount: 25_000,
              outstanding_interest_amount: 6.62,
            },
            // Plaid allows a student loan without an account. Nothing to attach it to.
            { account_id: null, interest_rate_percentage: 4 },
          ],
          mortgage: [
            {
              account_id: 'acct-mortgage',
              interest_rate: { percentage: 3.99, type: 'fixed' },
              last_payment_amount: 3100,
              last_payment_date: '2026-09-01',
              next_monthly_payment: 3141.54,
              next_payment_due_date: '2026-10-01',
              origination_date: '2021-04-15',
              origination_principal_amount: 425_000,
              past_due_amount: 2304,
            },
          ],
        },
      })
    )

    const { accounts, liabilities } = await client.getLiabilities(ACCESS_TOKEN)

    expect(accounts).toHaveLength(1)
    expect(liabilities).toEqual([
      {
        plaidAccountId: 'acct-card',
        kind: 'credit',
        // The purchase APR, not whichever came first.
        aprPercent: 22.49,
        minimumPaymentCents: 2_000,
        nextPaymentDueOn: '2026-10-01',
        lastPaymentCents: 16_825,
        lastPaymentOn: null,
        originationDate: null,
        originalPrincipalCents: null,
        isOverdue: false,
      },
      {
        plaidAccountId: 'acct-student',
        kind: 'student',
        aprPercent: 5.25,
        minimumPaymentCents: 2_500,
        nextPaymentDueOn: '2026-09-25',
        lastPaymentCents: 0,
        lastPaymentOn: '2026-08-25',
        originationDate: '2019-08-01',
        originalPrincipalCents: 2_500_000,
        isOverdue: false,
      },
      {
        plaidAccountId: 'acct-mortgage',
        kind: 'mortgage',
        aprPercent: 3.99,
        minimumPaymentCents: 314_154,
        nextPaymentDueOn: '2026-10-01',
        lastPaymentCents: 310_000,
        lastPaymentOn: '2026-09-01',
        originationDate: '2021-04-15',
        originalPrincipalCents: 42_500_000,
        isOverdue: true,
      },
    ])
  })

  it('falls back to the first APR on a card without a purchase APR', async () => {
    const { client } = plaid(() =>
      json({
        accounts: [],
        liabilities: {
          credit: [{ account_id: 'acct-card', aprs: [{ apr_percentage: 0, apr_type: 'special' }] }],
          student: null,
          mortgage: null,
        },
      })
    )

    const { liabilities } = await client.getLiabilities(ACCESS_TOKEN)

    expect(liabilities[0]?.aprPercent).toBe(0)
  })
})

describe('Plaid holdings', () => {
  it('keeps the total cost basis, names each security, and dates every position', async () => {
    const { client } = plaid(() =>
      json({
        accounts: [plaidAccount({ account_id: 'acct-brokerage', type: 'investment', subtype: 'brokerage' })],
        holdings: [
          {
            account_id: 'acct-brokerage',
            security_id: 'sec-vti',
            institution_price: 275,
            institution_price_as_of: '2026-09-11',
            institution_value: 2750.5,
            cost_basis: 1500.25,
            quantity: 10.0018,
            iso_currency_code: 'USD',
          },
          {
            account_id: 'acct-brokerage',
            security_id: 'sec-cash',
            institution_price: 1,
            institution_price_as_of: null,
            institution_price_datetime: '2026-09-12T20:00:00Z',
            institution_value: 120,
            cost_basis: null,
            quantity: 120,
          },
          {
            account_id: 'acct-brokerage',
            security_id: 'sec-unknown',
            institution_price: 3,
            institution_price_as_of: null,
            institution_value: 30,
            quantity: 10,
          },
        ],
        securities: [
          { security_id: 'sec-vti', ticker_symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', type: 'etf' },
          { security_id: 'sec-cash', ticker_symbol: null, name: 'U S Dollar', type: 'cash' },
        ],
      })
    )

    const { holdings } = await client.getHoldings(ACCESS_TOKEN)

    expect(holdings).toEqual([
      {
        plaidAccountId: 'acct-brokerage',
        plaidSecurityId: 'sec-vti',
        ticker: 'VTI',
        name: 'Vanguard Total Stock Market ETF',
        securityType: 'etf',
        quantity: 10.0018,
        costBasisCents: 150_025,
        valueCents: 275_050,
        asOf: '2026-09-11',
      },
      {
        plaidAccountId: 'acct-brokerage',
        plaidSecurityId: 'sec-cash',
        ticker: null,
        name: 'U S Dollar',
        securityType: 'cash',
        quantity: 120,
        costBasisCents: null,
        valueCents: 12_000,
        asOf: '2026-09-12',
      },
      {
        plaidAccountId: 'acct-brokerage',
        plaidSecurityId: 'sec-unknown',
        ticker: null,
        name: null,
        securityType: null,
        quantity: 10,
        costBasisCents: null,
        valueCents: 3_000,
        // No price date from the institution: the day it was fetched.
        asOf: '2026-09-14',
      },
    ])
  })
})

describe('Plaid failures', () => {
  const plaidBody = (errorType: string, errorCode: string) => ({
    error_type: errorType,
    error_code: errorCode,
    error_message: `the provided access token ${ACCESS_TOKEN} is broken`,
    display_message: null,
    request_id: 'req-1',
  })

  it.each([
    ['ITEM_ERROR', 'ITEM_LOGIN_REQUIRED', PlaidItemError],
    ['INSTITUTION_ERROR', 'INSTITUTION_DOWN', PlaidItemError],
    ['INVALID_INPUT', 'INVALID_ACCESS_TOKEN', PlaidItemError],
    ['ITEM_ERROR', 'PRODUCTS_NOT_SUPPORTED', PlaidProductUnavailableError],
    ['ITEM_ERROR', 'NO_LIABILITY_ACCOUNTS', PlaidProductUnavailableError],
    ['ITEM_ERROR', 'NO_INVESTMENT_ACCOUNTS', PlaidProductUnavailableError],
    ['INVALID_INPUT', 'ADDITIONAL_CONSENT_REQUIRED', PlaidProductUnavailableError],
    ['ITEM_ERROR', 'PRODUCT_NOT_READY', PlaidProviderError],
    ['RATE_LIMIT_EXCEEDED', 'ACCOUNTS_LIMIT', PlaidProviderError],
    ['API_ERROR', 'INTERNAL_SERVER_ERROR', PlaidProviderError],
    ['INVALID_REQUEST', 'MISSING_FIELDS', PlaidProviderError],
  ])('turns %s %s into %s', async (errorType, errorCode, expected) => {
    const { client } = plaid(() => json(plaidBody(errorType, errorCode), errorType === 'API_ERROR' ? 500 : 400))

    const error = await client.getAccounts(ACCESS_TOKEN).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(expected)
    if (error instanceof PlaidItemError || error instanceof PlaidProductUnavailableError) {
      expect(error.code).toBe(errorCode)
    }
  })

  it('never repeats a token, the secret or Plaid’s message in an error', async () => {
    const failures = [
      () => json(plaidBody('ITEM_ERROR', 'ITEM_LOGIN_REQUIRED'), 400),
      () => json(plaidBody('INVALID_REQUEST', 'MISSING_FIELDS'), 400),
      // An error code that isn't one is never carried.
      () => json(plaidBody('ITEM_ERROR', `bad ${ACCESS_TOKEN}`), 400),
      () => new Response(`<html>${SECRET}</html>`, { status: 502 }),
      () => json({ accounts: [{ account_id: ACCESS_TOKEN }] }),
      () => Promise.reject(new Error(`connect ECONNREFUSED ${SECRET}`)),
    ]
    for (const failure of failures) {
      const { client } = plaid(failure)
      const error = await client.getAccounts(ACCESS_TOKEN).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(Error)
      const text = `${(error as Error).name} ${(error as Error).message}`
      expect(text).not.toContain(ACCESS_TOKEN)
      expect(text).not.toContain(SECRET)
      expect(text).not.toContain('is broken')
    }
  })

  it('treats a network failure, an unreadable body or an unexpected shape as retry-later', async () => {
    const cases = [
      () => Promise.reject(new TypeError('fetch failed')),
      () => new Response('not json', { status: 503 }),
      () => json({ accounts: 'nope' }),
    ]
    for (const respond of cases) {
      const { client } = plaid(respond)
      await expect(client.getAccounts(ACCESS_TOKEN)).rejects.toBeInstanceOf(PlaidProviderError)
    }
  })

  it('reads only the error type and code from a body', () => {
    expect(plaidError(400, { error_type: 'ITEM_ERROR' })).toBeInstanceOf(PlaidProviderError)
    expect(plaidError(400, null)).toBeInstanceOf(PlaidProviderError)
  })
})
