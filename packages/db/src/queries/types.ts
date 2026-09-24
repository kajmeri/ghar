import type { RequestContext } from '@ghar/contracts'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type * as schema from '../schema'

/** Any Drizzle client over this schema: postgres-js in the app, PGlite in tests, or a transaction. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

export type { RequestContext }

/**
 * A signed-in person who may not belong to a household yet. Only session.ts accepts one,
 * for what has to happen before a RequestContext can exist: finding the membership,
 * creating a household, and reading or accepting an invitation.
 */
export interface SessionContext {
  readonly userId: string
  /** From the verified session, never from a request body. */
  readonly email: string | null
}

/**
 * Work nobody signed in did: a cron sync, a verified webhook. Its household always comes from a
 * stored row, never from a request. It has no role, so only functions that document accepting an
 * Actor take one.
 */
export interface SystemContext {
  readonly householdId: string
  readonly userId: null
}

export type Actor = RequestContext | SystemContext

/**
 * A guest acting on a trip another household owns: answering its invitation. Only audit rows take
 * one, filed under the trip's household with the guest as the actor. It has no role, because a
 * guest is not a member.
 */
export interface GuestActor {
  readonly householdId: string
  readonly userId: string
  readonly role?: never
}
