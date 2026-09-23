import 'server-only'
import type { BankEnvironment } from '@ghar/core/banking'
import { env } from '@/lib/env'
import { createFakePlaidClient } from './fake'
import { createPlaidClient } from './plaid'
import type { PlaidClient } from './types'

export {
  createFakePlaidClient,
  fakePlaidStore,
  FakePlaidStore,
  FAKE_LINK_TOKEN,
  FAKE_PUBLIC_TOKEN,
  sampleFakePlaidItem,
  sampleFakePlaidTransactions,
  type FakePlaidItem,
} from './fake'
export { PlaidItemError, PlaidProductUnavailableError, PlaidProviderError, type LinkTokenRequest, type PlaidClient } from './types'
export { parsePlaidWebhook } from './webhook'

/** Without Plaid keys, local development can only sync made-up connections. */
export function usesFakePlaid(): boolean {
  const { PLAID_CLIENT_ID, PLAID_SECRET } = env()
  return !PLAID_CLIENT_ID || !PLAID_SECRET
}

/**
 * Where a connection made right now would live: the Plaid environment the secret is for, or `fake`
 * without keys. Throws in production without them, so a deployment can't quietly make up a bank.
 */
export function currentBankEnvironment(): BankEnvironment {
  if (!usesFakePlaid()) return env().PLAID_ENV
  if (process.env.NODE_ENV === 'production') {
    throw new Error('PLAID_CLIENT_ID or PLAID_SECRET is not set, and production cannot connect a bank without them.')
  }
  return 'fake'
}

/**
 * The client for connections made in `environment`, or null when this deployment can't sync them: a
 * made-up connection in production, a real one locally without keys, or one from the Plaid environment
 * the secret isn't for. Throws when production has no keys, so the sync fails loudly.
 */
export function getPlaidClient(environment: BankEnvironment): PlaidClient | null {
  const production = process.env.NODE_ENV === 'production'
  if (environment === 'fake') return production ? null : createFakePlaidClient()
  const { PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV } = env()
  if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
    if (production) {
      throw new Error('PLAID_CLIENT_ID or PLAID_SECRET is not set, and production cannot sync bank connections without them.')
    }
    return null
  }
  if (environment !== PLAID_ENV) return null
  return createPlaidClient({ clientId: PLAID_CLIENT_ID, secret: PLAID_SECRET, environment })
}
