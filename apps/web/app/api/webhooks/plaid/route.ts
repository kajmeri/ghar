import { handleBankWebhook } from '@/lib/banking/connect'
import { parsePlaidWebhook } from '@/lib/providers/plaid'

// Where Plaid posts what it notices about a connection: new transactions to fetch, a sign-in that
// stopped working, consent about to run out.
//
// Nothing about the request is trusted until the JWT in `plaid-verification` is checked against
// Plaid's own verification key, for the Plaid environment the named connection lives in
// (lib/banking/connect.ts). Until then the body is only a claim about which connection this is.
//
// Plaid retries anything that isn't a 2xx, so a webhook Ghar has no use for still answers 200: a
// connection it doesn't have, a code it doesn't act on, or a body it can't read. Only an unsigned
// or wrongly signed webhook is refused, and only a genuine failure asks Plaid to try again.

export const dynamic = 'force-dynamic'

const ok = (outcome: string) => Response.json({ status: outcome }, { headers: { 'cache-control': 'no-store' } })

export async function POST(request: Request): Promise<Response> {
  const jwt = request.headers.get('plaid-verification')
  // The signature covers the exact bytes, so the raw body is read once and reused for both.
  const body = await request.text()

  if (!jwt) {
    return Response.json({ status: 'unverified' }, { status: 401, headers: { 'cache-control': 'no-store' } })
  }

  let payload: unknown
  try {
    payload = JSON.parse(body) as unknown
  } catch {
    return ok('ignored')
  }

  try {
    const outcome = await handleBankWebhook(parsePlaidWebhook(payload), { body, jwt })
    if (outcome === 'unverified') {
      return Response.json({ status: outcome }, { status: 401, headers: { 'cache-control': 'no-store' } })
    }
    return ok(outcome)
  } catch (error) {
    // Nothing from the webhook is echoed back: a sender learns only that it failed.
    console.error('Plaid webhook failed', error)
    return Response.json({ status: 'error' }, { status: 500, headers: { 'cache-control': 'no-store' } })
  }
}
