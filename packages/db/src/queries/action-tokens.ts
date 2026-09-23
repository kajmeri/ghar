import type { CalendarDate } from '@ghar/core/dates'
import { can } from '@ghar/core/auth'
import { notRenewingKind, oneTapActionHasDate, ONE_TAP_PERMISSIONS, type OneTapAction } from '@ghar/core/digest'
import { NotFoundError, ValidationError } from '@ghar/core/errors'
import { and, eq, gt, isNull, lt } from 'drizzle-orm'
import { actionTokens, assets, bills, documents, householdMembers, renewals, transactions } from '../schema'
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
  /** The transaction, bill, document, asset (for a warranty) or renewal. */
  entityId: string
  /**
   * For `mark_bill_paid`, the due date it marks paid; for a "not renewing" action, the date it runs
   * out on that the link dismisses. Null for the others.
   */
  dueOn: CalendarDate | null
  expiresAt: Date
}

/** Whether the thing a link acts on is in the actor's household, and one they can see. */
async function entityExists(actor: Actor, db: Db, action: OneTapAction, entityId: string): Promise<boolean> {
  const subjectKind = notRenewingKind(action)
  const rows =
    action === 'categorize_transaction'
      ? await db
          .select({ id: transactions.id })
          .from(transactions)
          .where(and(eq(transactions.id, entityId), eq(transactions.householdId, actor.householdId)))
          .limit(1)
      : action === 'mark_bill_paid'
        ? await db
            .select({ id: bills.id })
            .from(bills)
            .where(and(eq(bills.id, entityId), eq(bills.householdId, actor.householdId)))
            .limit(1)
        : subjectKind === 'document'
          ? await db
              .select({ id: documents.id })
              .from(documents)
              .where(
                and(
                  eq(documents.id, entityId),
                  eq(documents.householdId, actor.householdId),
                  actor.userId === null || can(actor.role, 'documents.viewSensitive') ? undefined : eq(documents.isSensitive, false)
                )
              )
              .limit(1)
          : subjectKind === 'warranty'
            ? await db
                .select({ id: assets.id })
                .from(assets)
                .where(and(eq(assets.id, entityId), eq(assets.householdId, actor.householdId)))
                .limit(1)
            : await db
                .select({ id: renewals.id })
                .from(renewals)
                .where(and(eq(renewals.id, entityId), eq(renewals.householdId, actor.householdId)))
                .limit(1)
  return rows.length > 0
}

/** Makes the row behind a one-tap link, for something in the actor's household they're allowed to change. */
export async function createActionToken(actor: Actor, db: Db, input: ActionTokenGrant): Promise<{ id: string }> {
  authorize(actor, ONE_TAP_PERMISSIONS[input.action])
  const hasDate = oneTapActionHasDate(input.action)
  if (hasDate && input.dueOn === null) throw new ValidationError('That link needs a date.')
  if (!(await entityExists(actor, db, input.action, input.entityId))) throw new NotFoundError('That no longer exists.')
  const [token] = await db
    .insert(actionTokens)
    .values({ householdId: actor.householdId, ...input, dueOn: hasDate ? input.dueOn : null })
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
