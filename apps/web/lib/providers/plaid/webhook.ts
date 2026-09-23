import 'server-only'
import type { BankWebhookEvent } from '@ghar/core/banking'
import { z } from 'zod'

// Plaid's webhook bodies, turned into the events @ghar/core/banking reasons about. Parsing only:
// whether the webhook is genuine is the client's verifyWebhook, and what it changes is
// bankItemStateForWebhook. Anything unrecognized becomes `ignored` rather than an error, because
// Plaid adds webhook codes without warning and a 4xx makes it retry something we'll never want.

const webhookSchema = z.object({
  webhook_type: z.string(),
  webhook_code: z.string(),
  item_id: z.string().nullish(),
  error: z.object({ error_code: z.string().nullish() }).nullish(),
  /** On PENDING_EXPIRATION: when consent runs out, as an ISO instant. */
  consent_expiration_time: z.string().nullish(),
})

function instantOrNull(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Plaid's body to one event. Never throws: an unreadable body is an ignored event. */
export function parsePlaidWebhook(payload: unknown): BankWebhookEvent {
  const parsed = webhookSchema.safeParse(payload)
  if (!parsed.success) {
    return { kind: 'ignored', webhookType: 'unknown', webhookCode: 'unknown', plaidItemId: null }
  }
  const { webhook_type: type, webhook_code: code, item_id: itemId } = parsed.data
  const ignored: BankWebhookEvent = { kind: 'ignored', webhookType: type, webhookCode: code, plaidItemId: itemId ?? null }
  // Every event below is about one connection, so a body without an item id can't be acted on.
  if (!itemId) return ignored

  if (type === 'TRANSACTIONS' && code === 'SYNC_UPDATES_AVAILABLE') {
    return { kind: 'sync_available', plaidItemId: itemId }
  }

  if (type !== 'ITEM') return ignored

  switch (code) {
    case 'ERROR': {
      const errorCode = parsed.data.error?.error_code
      return errorCode ? { kind: 'item_error', plaidItemId: itemId, errorCode } : ignored
    }
    case 'LOGIN_REPAIRED':
      return { kind: 'login_repaired', plaidItemId: itemId }
    // Both mean the connection still works but needs a sign-in before a deadline.
    case 'PENDING_EXPIRATION':
    case 'PENDING_DISCONNECT':
      return { kind: 'consent_expiring', plaidItemId: itemId, expiresAt: instantOrNull(parsed.data.consent_expiration_time) }
    case 'USER_PERMISSION_REVOKED':
    case 'USER_ACCOUNT_REVOKED':
      return { kind: 'permission_revoked', plaidItemId: itemId }
    default:
      return ignored
  }
}
