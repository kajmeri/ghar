import type { CalendarDate } from '@ghar/core/dates'
import type { OneTapAction } from '@ghar/core/digest'
import { NotFoundError } from '@ghar/core/errors'
import { and, eq, gt, isNull, lt } from 'drizzle-orm'
import { actionTokens, bills, householdMembers, transactions } from '../schema'
import { authorize } from './authorize'
import type { Actor, Db, RequestContext } from './types'

// One-tap links from emails. A link names a row here, and an HMAC over the row's id, action and
// entity (apps/web/lib/one-tap.ts) proves Ghar made it. The row is what makes it single-use: using
// it marks it used in the same transaction as the change it makes, so a change that fails leaves the
// link as it was. findActionToken and consumeActionToken take no context, because the verified link
// is how the household is found.

export interface ActionTokenGrant {
  /** Who the link was sent to. It acts as them, with the role they hold when it's used. */
  userId: string
  action: OneTapAction
  /** The transaction or bill. */
  entityId: string
  /** For `mark_bill_paid`: the due date it marks paid. Null otherwise. */
  dueOn: CalendarDate | null
  expiresAt: Date
}

/** Makes the row behind a one-tap link, for a transaction or bill in the actor's household. */
export async function createActionToken(actor: Actor, db: Db, input: ActionTokenGrant): Promise<{ id: string }> {
  authorize(actor, 'finances.manage')
  const [entity] =
    input.action === 'categorize_transaction'
      ? await db
          .select({ id: transactions.id })
          .from(transactions)
          .where(and(eq(transactions.id, input.entityId), eq(transactions.householdId, actor.householdId)))
          .limit(1)
      : await db
          .select({ id: bills.id })
          .from(bills)
          .where(and(eq(bills.id, input.entityId), eq(bills.householdId, actor.householdId)))
          .limit(1)
  if (!entity) throw new NotFoundError('That no longer exists.')
  const [token] = await db
    .insert(actionTokens)
    .values({ householdId: actor.householdId, ...input, dueOn: input.action === 'mark_bill_paid' ? input.dueOn : null })
    .returning({ id: actionTokens.id })
  if (!token) throw new Error('Action token insert returned no row')
  return token
}

export interface ActionTokenRow {
  id: string
  householdId: string
  userId: string
  /** The person's role now, not when the link was sent. */
  role: RequestContext['role']
  action: OneTapAction
  entityId: string
  dueOn: CalendarDate | null
  expiresAt: Date
  usedAt: Date | null
}

/**
 * The row behind a verified link, or null when there's none: it was cleaned up, or its person left
 * the household and took their links with them.
 */
export async function findActionToken(db: Db, input: { tokenId: string }): Promise<ActionTokenRow | null> {
  const [token] = await db
    .select({
      id: actionTokens.id,
      householdId: actionTokens.householdId,
      userId: actionTokens.userId,
      role: householdMembers.role,
      action: actionTokens.action,
      entityId: actionTokens.entityId,
      dueOn: actionTokens.dueOn,
      expiresAt: actionTokens.expiresAt,
      usedAt: actionTokens.usedAt,
    })
    .from(actionTokens)
    .innerJoin(
      householdMembers,
      and(eq(householdMembers.householdId, actionTokens.householdId), eq(householdMembers.userId, actionTokens.userId))
    )
    .where(eq(actionTokens.id, input.tokenId))
    .limit(1)
  return token ?? null
}

/**
 * Marks a link used, if it's unused, unexpired, and for this action on this thing. Returns whether it
 * did, so a second tap, or two taps at once, change nothing. Call it in the transaction that makes the
 * link's change.
 */
export async function consumeActionToken(
  db: Db,
  input: { tokenId: string; action: OneTapAction; entityId: string; now: Date }
): Promise<boolean> {
  const used = await db
    .update(actionTokens)
    .set({ usedAt: input.now })
    .where(
      and(
        eq(actionTokens.id, input.tokenId),
        eq(actionTokens.action, input.action),
        eq(actionTokens.entityId, input.entityId),
        isNull(actionTokens.usedAt),
        gt(actionTokens.expiresAt, input.now)
      )
    )
    .returning({ id: actionTokens.id })
  return used.length > 0
}

/** Removes links that expired before `before`, used or not. For the daily job, across households. */
export async function deleteExpiredActionTokens(db: Db, input: { before: Date }): Promise<number> {
  const deleted = await db.delete(actionTokens).where(lt(actionTokens.expiresAt, input.before)).returning({ id: actionTokens.id })
  return deleted.length
}
