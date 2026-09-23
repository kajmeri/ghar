import { createHash, generateKeyPairSync, sign as signWith } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createPlaidClient } from '@/lib/providers/plaid/plaid'
import { parsePlaidWebhook } from '@/lib/providers/plaid/webhook'

// Connecting a bank and syncing its transactions, against a stand-in fetch: what the client sends
// Plaid, how it reads what comes back, and what it makes of a signed webhook. Nothing here reaches
// Plaid, and the webhook signatures are real ones made with a key pair generated in the test.

const NOW = new Date('2026-09-14T15:00:00Z')
const ACCESS_TOKEN = 'access-sandbox-5c1a0f7e'

interface Sent {
  url: string
  body: Record<string, unknown>
}

function plaid(respond: (url: string, body: Record<string, unknown>) => Response) {
  const sent: Sent[] = []
  const fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>
    sent.push({ url, body })
    return Promise.resolve(respond(url, body))
  }
  const client = createPlaidClient({ clientId: 'client-1', secret: 'secret-1', environment: 'sandbox', fetch, now: () => NOW })
  return { client, sent }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function plaidTransaction(overrides: Record<string, unknown> = {}) {
  return {
    transaction_id: 'txn-1',
    account_id: 'acct-1',
    pending_transaction_id: null,
    amount: 12.34,
    iso_currency_code: 'USD',
    date: '2026-09-12',
    authorized_date: '2026-09-11',
    merchant_name: 'Trader Joe’s',
    name: 'TRADER JOES 412 SF',
    payment_channel: 'in store',
    personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_GROCERIES', confidence_level: 'HIGH' },
    pending: false,
    ...overrides,
  }
}

describe('link tokens', () => {
  it('asks for transactions on a new connection, and names no product in update mode', async () => {
    const { client, sent } = plaid(() => json({ link_token: 'link-sandbox-1', expiration: '2026-09-14T19:00:00Z' }))

    const fresh = await client.createLinkToken({ userRef: 'household-1', webhookUrl: 'https://ghar.test/api/webhooks/plaid' })
    expect(fresh).toEqual({ token: 'link-sandbox-1', expiresAt: new Date('2026-09-14T19:00:00Z') })
    expect(sent[0]?.body).toMatchObject({
      client_name: 'Ghar',
      user: { client_user_id: 'household-1' },
      products: ['transactions'],
      webhook: 'https://ghar.test/api/webhooks/plaid',
    })
    expect(sent[0]?.body).not.toHaveProperty('access_token')

    await client.createLinkToken({ userRef: 'household-1', webhookUrl: null, accessToken: ACCESS_TOKEN })
    expect(sent[1]?.body).toMatchObject({ access_token: ACCESS_TOKEN })
    // Update mode repairs the connection it is given; naming a product would make Plaid refuse it.
    expect(sent[1]?.body).not.toHaveProperty('products')
    expect(sent[1]?.body).not.toHaveProperty('webhook')
  })

  it('trades a public token without ever putting it in the URL', async () => {
    const { client, sent } = plaid(() => json({ access_token: ACCESS_TOKEN, item_id: 'item-9' }))

    expect(await client.exchangePublicToken('public-sandbox-77')).toEqual({ accessToken: ACCESS_TOKEN, plaidItemId: 'item-9' })
    expect(sent[0]?.url).toBe('https://sandbox.plaid.com/item/public_token/exchange')
    expect(sent[0]?.url).not.toContain('public-sandbox-77')
    expect(sent[0]?.body).toMatchObject({ public_token: 'public-sandbox-77' })
  })

  it('keeps the connection when the institution lookup fails', async () => {
    const { client } = plaid(url =>
      url.endsWith('/item/get') ? json({ item: { item_id: 'item-9', institution_id: 'ins_3' } }) : json({}, 500)
    )

    expect(await client.getInstitution(ACCESS_TOKEN)).toEqual({ institutionId: 'ins_3', name: null })
  })
})

describe('transaction sync', () => {
  it('follows Plaid’s pages, flips the sign of money out, and returns the last cursor', async () => {
    let call = 0
    const { client, sent } = plaid(() => {
      call += 1
      return call === 1
        ? json({
            accounts: [],
            added: [plaidTransaction()],
            modified: [],
            removed: [],
            next_cursor: 'cursor-1',
            has_more: true,
          })
        : json({
            accounts: [
              {
                account_id: 'acct-1',
                name: 'Everyday checking',
                mask: '0142',
                type: 'depository',
                subtype: 'checking',
                balances: { current: 482.31, available: 482.31, iso_currency_code: 'USD' },
              },
            ],
            added: [],
            modified: [plaidTransaction({ transaction_id: 'txn-2', amount: -50, pending: true })],
            removed: [{ transaction_id: 'txn-0' }],
            next_cursor: 'cursor-2',
            has_more: false,
          })
    })

    const result = await client.syncTransactions(ACCESS_TOKEN, null)

    // A first sync leaves the cursor out entirely; Plaid refuses an explicit null.
    expect(sent[0]?.body).not.toHaveProperty('cursor')
    expect(sent[1]?.body).toMatchObject({ cursor: 'cursor-1' })
    expect(result.nextCursor).toBe('cursor-2')
    expect(result.hasMore).toBe(false)
    expect(result.accounts).toHaveLength(1)

    // $12.34 spent is -1234 cents; a refund of -$50 is money in.
    expect(result.pages[0]?.added[0]).toMatchObject({
      plaidTransactionId: 'txn-1',
      amountCents: -1_234,
      date: '2026-09-12',
      merchantName: 'Trader Joe’s',
      categoryDetailed: 'FOOD_AND_DRINK_GROCERIES',
      isPending: false,
    })
    expect(result.pages[1]?.modified[0]).toMatchObject({ amountCents: 5_000, isPending: true })
    expect(result.pages[1]?.removed).toEqual(['txn-0'])
  })
})

// ---------------------------------------------------------------------------------------------
// Webhooks

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const jwk = publicKey.export({ format: 'jwk' }) as { crv: string; x: string; y: string }

const base64Url = (value: string | Buffer) => Buffer.from(value).toString('base64url')

function signWebhook(body: string, overrides: { iat?: number; header?: Record<string, unknown>; bodyHash?: string } = {}): string {
  const header = base64Url(JSON.stringify({ alg: 'ES256', kid: 'key-1', typ: 'JWT', ...overrides.header }))
  const claims = base64Url(
    JSON.stringify({
      iat: overrides.iat ?? Math.floor(NOW.getTime() / 1000),
      request_body_sha256: overrides.bodyHash ?? createHash('sha256').update(body, 'utf8').digest('hex'),
    })
  )
  const signature = signWith('sha256', Buffer.from(`${header}.${claims}`), { key: privateKey, dsaEncoding: 'ieee-p1363' })
  return `${header}.${claims}.${base64Url(signature)}`
}

function verifier(key: Record<string, unknown> = {}) {
  return plaid(() => json({ key: { alg: 'ES256', kty: 'EC', crv: jwk.crv, x: jwk.x, y: jwk.y, expired_at: null, ...key } }))
}

describe('webhook verification', () => {
  const body = JSON.stringify({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: 'item-9' })

  it('accepts a webhook signed for exactly this body', async () => {
    const { client, sent } = verifier()
    expect(await client.verifyWebhook({ body, jwt: signWebhook(body), now: NOW })).toBe(true)
    expect(sent[0]?.body).toMatchObject({ key_id: 'key-1' })

    // The key for a kid never changes, so it is fetched once however many webhooks arrive.
    expect(await client.verifyWebhook({ body, jwt: signWebhook(body), now: NOW })).toBe(true)
    expect(sent).toHaveLength(1)
  })

  it('refuses a body that changed after it was signed', async () => {
    const { client } = verifier()
    const tampered = JSON.stringify({ webhook_type: 'ITEM', webhook_code: 'ERROR', item_id: 'item-9' })
    expect(await client.verifyWebhook({ body: tampered, jwt: signWebhook(body), now: NOW })).toBe(false)
  })

  it('refuses another algorithm, an old signature, and a retired key', async () => {
    const unsigned = `${base64Url(JSON.stringify({ alg: 'none', kid: 'key-1' }))}.${base64Url(JSON.stringify({ iat: 1, request_body_sha256: 'x' }))}.`
    expect(await verifier().client.verifyWebhook({ body, jwt: unsigned, now: NOW })).toBe(false)

    const stale = signWebhook(body, { iat: Math.floor(NOW.getTime() / 1000) - 600 })
    expect(await verifier().client.verifyWebhook({ body, jwt: stale, now: NOW })).toBe(false)

    const retired = verifier({ expired_at: 1_700_000_000 })
    expect(await retired.client.verifyWebhook({ body, jwt: signWebhook(body), now: NOW })).toBe(false)
  })

  it('refuses a signature made with the wrong key', async () => {
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const otherJwk = other.publicKey.export({ format: 'jwk' }) as { crv: string; x: string; y: string }
    const { client } = verifier({ x: otherJwk.x, y: otherJwk.y })
    expect(await client.verifyWebhook({ body, jwt: signWebhook(body), now: NOW })).toBe(false)
  })
})

describe('webhook bodies', () => {
  it('reads the codes Ghar acts on', () => {
    expect(parsePlaidWebhook({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: 'item-9' })).toEqual({
      kind: 'sync_available',
      plaidItemId: 'item-9',
    })
    expect(
      parsePlaidWebhook({ webhook_type: 'ITEM', webhook_code: 'ERROR', item_id: 'item-9', error: { error_code: 'ITEM_LOGIN_REQUIRED' } })
    ).toEqual({ kind: 'item_error', plaidItemId: 'item-9', errorCode: 'ITEM_LOGIN_REQUIRED' })
    expect(parsePlaidWebhook({ webhook_type: 'ITEM', webhook_code: 'LOGIN_REPAIRED', item_id: 'item-9' })).toEqual({
      kind: 'login_repaired',
      plaidItemId: 'item-9',
    })
    expect(
      parsePlaidWebhook({
        webhook_type: 'ITEM',
        webhook_code: 'PENDING_EXPIRATION',
        item_id: 'item-9',
        consent_expiration_time: '2026-10-01T00:00:00Z',
      })
    ).toEqual({ kind: 'consent_expiring', plaidItemId: 'item-9', expiresAt: new Date('2026-10-01T00:00:00Z') })
    expect(parsePlaidWebhook({ webhook_type: 'ITEM', webhook_code: 'USER_PERMISSION_REVOKED', item_id: 'item-9' })).toEqual({
      kind: 'permission_revoked',
      plaidItemId: 'item-9',
    })
  })

  it('ignores what it doesn’t act on rather than failing', () => {
    expect(parsePlaidWebhook({ webhook_type: 'ITEM', webhook_code: 'NEW_ACCOUNTS_AVAILABLE', item_id: 'item-9' })).toMatchObject({
      kind: 'ignored',
      plaidItemId: 'item-9',
    })
    // An ERROR without a code says nothing about what is wrong.
    expect(parsePlaidWebhook({ webhook_type: 'ITEM', webhook_code: 'ERROR', item_id: 'item-9' })).toMatchObject({ kind: 'ignored' })
    expect(parsePlaidWebhook({ nonsense: true })).toMatchObject({ kind: 'ignored', plaidItemId: null })
    expect(parsePlaidWebhook({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE' })).toMatchObject({ kind: 'ignored' })
  })
})
