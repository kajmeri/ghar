import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { instantSchema } from './shared'

// Bank connections: making one through Plaid Link, repairing one, and syncing one by hand.
// Owners and adults only, like everything else under money.
//
// Nothing here ever carries a Plaid access token, a public token Plaid has already been given, or
// a sync cursor. A client only ever sees which bank a connection is with and how it is faring.

/** Mirrors BANK_ENVIRONMENTS in @ghar/core/banking. */
export const bankEnvironmentSchema = z.enum(['fake', 'sandbox', 'production'])

/** Mirrors BANK_ITEM_STATUSES in @ghar/core/banking. */
export const bankConnectionStatusSchema = z.enum(['good', 'login_required', 'error', 'disconnected'])

/** Mirrors BankItemAttention in @ghar/core/banking. Null when nothing needs doing. */
export const bankConnectionAttentionSchema = z.enum(['reconnect', 'consent_expiring', 'revoked', 'sync_error'])

export const bankConnectionSchema = z.object({
  id: z.uuid(),
  /** Null when Plaid didn't name the institution. */
  institutionName: z.string().nullable(),
  environment: bankEnvironmentSchema,
  status: bankConnectionStatusSchema,
  /** What, if anything, this connection needs from a person. */
  attention: bankConnectionAttentionSchema.nullable(),
  /** True when update-mode Link can repair it without making a new connection. */
  canReconnect: z.boolean(),
  /** When the household turned it off. Null on one that is still connected. */
  disconnectedAt: instantSchema.nullable(),
  /** Accounts this connection brought in, however long ago it stopped syncing. */
  accountCount: z.int(),
  /** Charges it brought in, still filed under their categories. */
  transactionCount: z.int(),
  /** When consent runs out, for the connections that say. */
  consentExpiresAt: instantSchema.nullable(),
  lastSyncedAt: instantSchema.nullable(),
  createdAt: instantSchema,
})
export type BankConnection = z.infer<typeof bankConnectionSchema>

/** What one sync moved. `synced` is false when Plaid refused: the connection says why. */
export const bankSyncResultSchema = z.object({
  synced: z.boolean(),
  inserted: z.int(),
  updated: z.int(),
  deleted: z.int(),
})
export type BankSyncResult = z.infer<typeof bankSyncResultSchema>

/**
 * Which Link a client should open. `plaid` is the real thing and needs Plaid's script; `fake` is
 * the in-memory stand-in this deployment uses without Plaid keys, which needs no browser flow at
 * all: post its link token straight back as the public token.
 */
export const bankLinkProviderSchema = z.enum(['plaid', 'fake'])
export type BankLinkProviderValue = z.infer<typeof bankLinkProviderSchema>

const connectionResponseSchema = z.object({ connection: bankConnectionSchema, sync: bankSyncResultSchema })

const bankConnectionParamsSchema = z.object({ itemId: z.uuid() })

/** Oldest first, the order they were connected in. */
export const listBankConnections = defineEndpoint({
  method: 'GET',
  path: '/api/v1/bank-connections',
  response: z.object({
    connections: z.array(bankConnectionSchema),
    provider: bankLinkProviderSchema,
    /** False when this deployment can't make new connections at all. */
    canConnect: z.boolean(),
  }),
})

/** A token for opening Link. With `itemId`, update mode for repairing that connection. */
export const createBankLinkToken = defineEndpoint({
  method: 'POST',
  path: '/api/v1/bank-connections/link-token',
  body: z.object({ itemId: z.uuid().optional() }).prefault({}),
  response: z.object({
    linkToken: z.string(),
    expiresAt: instantSchema,
    provider: bankLinkProviderSchema,
  }),
})

/** Finishes a new connection with the public token Link handed back. */
export const createBankConnection = defineEndpoint({
  method: 'POST',
  path: '/api/v1/bank-connections',
  body: z.object({ publicToken: z.string().trim().min(1).max(512) }),
  response: connectionResponseSchema,
})

/** Finishes an update-mode Link: the connection goes back to good and catches up. */
export const reconnectBankConnection = defineEndpoint({
  method: 'POST',
  path: '/api/v1/bank-connections/:itemId/reconnect',
  params: bankConnectionParamsSchema,
  response: connectionResponseSchema,
})

/** Syncs one connection now, instead of waiting for the daily run. */
export const syncBankConnection = defineEndpoint({
  method: 'POST',
  path: '/api/v1/bank-connections/:itemId/sync',
  params: bankConnectionParamsSchema,
  response: connectionResponseSchema,
})

/**
 * Turns a connection off: the access token is revoked at Plaid and nothing syncs after. Every
 * account, charge, category, note and trip tag it brought in stays exactly where it is. Deleting
 * those is a separate thing somebody has to ask for.
 */
export const disconnectBankConnection = defineEndpoint({
  method: 'POST',
  path: '/api/v1/bank-connections/:itemId/disconnect',
  params: bankConnectionParamsSchema,
  response: z.object({ connection: bankConnectionSchema }),
})

/**
 * Deletes what a connection that was turned off brought in: its accounts, their charges and their
 * balance history. This cannot be undone, and the connection itself stays as a record that the
 * bank was once linked.
 */
export const deleteBankConnectionHistory = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/bank-connections/:itemId/history',
  params: bankConnectionParamsSchema,
  response: z.object({
    connection: bankConnectionSchema,
    /** What went: rows, not money. */
    removed: z.object({ accounts: z.int(), transactions: z.int() }),
  }),
})
