import 'server-only'
import { can } from '@ghar/core/auth'
import { todayInTimeZone, type CalendarDate } from '@ghar/core/dates'
import { ConflictError, NotFoundError, ValidationError } from '@ghar/core/errors'
import * as queries from '@ghar/db/queries'
import type { ActionTokenRow, Db, RequestContext } from '@ghar/db/queries'
import { getDb } from '@/lib/db'
import { getOneTapKey, parseOneTapLink, verifyOneTapLink } from '@/lib/one-tap'

// What a one-tap link from the digest shows and does. Opening a link changes nothing, because mail
// scanners open links too: it shows what the tap will do, and the button on that page does it. The
// signed link is the only credential, so it acts as the person it was sent to, with the role they
// hold now, on the one thing it names, once.

export interface OneTapDeps {
  db: Db
  key: Buffer
  now: Date
}

function defaultDeps(): OneTapDeps {
  return { db: getDb(), key: getOneTapKey(), now: new Date() }
}

export type OneTapView =
  | { state: 'invalid' }
  | { state: 'used' }
  | { state: 'expired' }
  /** Their role no longer lets them change money. */
  | { state: 'not_allowed' }
  /** The transaction or bill was deleted. */
  | { state: 'gone' }
  | {
      state: 'categorize'
      currency: string
      transaction: { description: string; date: CalendarDate; amountCents: number; accountName: string | null; categoryId: string | null }
      categories: { id: string; label: string }[]
    }
  | { state: 'mark_paid'; currency: string; bill: { name: string; dueOn: CalendarDate; amountCents: number | null } }

type Resolved = { token: ActionTokenRow; ctx: RequestContext; dueOn: CalendarDate | null }

/** The link's row and who it acts as, or the page to show instead. Tampered and unknown links look the same. */
async function resolve(deps: OneTapDeps, value: string): Promise<Resolved | OneTapView> {
  const link = parseOneTapLink(value)
  if (!link) return { state: 'invalid' }
  const token = await queries.findActionToken(deps.db, { tokenId: link.tokenId })
  if (!token) return { state: 'invalid' }
  const grant = { tokenId: token.id, action: token.action, entityId: token.entityId, dueOn: token.dueOn }
  if (!verifyOneTapLink(deps.key, link, grant)) return { state: 'invalid' }
  if (token.usedAt !== null) return { state: 'used' }
  if (token.expiresAt.getTime() <= deps.now.getTime()) return { state: 'expired' }
  if (token.action === 'mark_bill_paid' && token.dueOn === null) return { state: 'invalid' }
  const ctx: RequestContext = { userId: token.userId, householdId: token.householdId, role: token.role }
  if (!can(ctx.role, 'finances.manage')) return { state: 'not_allowed' }
  return { token, ctx, dueOn: token.dueOn }
}

function isView(value: Resolved | OneTapView): value is OneTapView {
  return 'state' in value
}

/** What the page for a link shows. Reads only. */
export async function viewOneTap(value: string, deps: OneTapDeps = defaultDeps()): Promise<OneTapView> {
  const resolved = await resolve(deps, value)
  if (isView(resolved)) return resolved
  const { token, ctx, dueOn } = resolved
  try {
    // The household's currency is read beside the entity, not before it.
    if (token.action === 'categorize_transaction') {
      const [{ currency }, transaction, categories] = await Promise.all([
        queries.getHousehold(ctx, deps.db),
        queries.getTransaction(ctx, deps.db, { transactionId: token.entityId }),
        queries.listCategories(ctx, deps.db),
      ])
      return {
        state: 'categorize',
        currency,
        transaction: {
          description: transaction.merchantName ?? transaction.name,
          date: transaction.date,
          amountCents: transaction.amountCents,
          accountName: transaction.accountName,
          categoryId: transaction.categoryId,
        },
        categories: categoryOptions(categories),
      }
    }
    const [{ currency }, bill] = await Promise.all([queries.getHousehold(ctx, deps.db), queries.getBill(ctx, deps.db, token.entityId)])
    return { state: 'mark_paid', currency, bill: { name: bill.name, dueOn: dueOn ?? '', amountCents: bill.amountCents } }
  } catch (error) {
    if (error instanceof NotFoundError) return { state: 'gone' }
    throw error
  }
}

/** Unarchived categories, each child after its parent and labelled with it. */
function categoryOptions(rows: readonly queries.CategoryRow[]): { id: string; label: string }[] {
  const live = rows.filter(row => !row.isArchived)
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
  return live
    .filter(row => row.parentId === null)
    .toSorted(byName)
    .flatMap(parent => [
      { id: parent.id, label: parent.name },
      ...live
        .filter(row => row.parentId === parent.id)
        .toSorted(byName)
        .map(child => ({ id: child.id, label: `${parent.name}: ${child.name}` })),
    ])
}

/**
 * Does what the link says, and uses it up in the same transaction, so a change that fails leaves the
 * link working and a second tap changes nothing. Returns what to tell the person.
 */
export async function applyOneTap(value: string, input: { categoryId?: string }, deps: OneTapDeps = defaultDeps()): Promise<string> {
  const resolved = await resolve(deps, value)
  if (isView(resolved)) throw refusal(resolved)
  const { token, ctx, dueOn } = resolved

  return deps.db.transaction(async tx => {
    const consumed = await queries.consumeActionToken(tx, {
      tokenId: token.id,
      action: token.action,
      entityId: token.entityId,
      now: deps.now,
    })
    if (!consumed) throw new ConflictError('This link has already been used.')

    if (token.action === 'categorize_transaction') {
      const categories = await queries.listCategories(ctx, tx)
      const category = categories.find(row => row.id === input.categoryId && !row.isArchived)
      if (!category) {
        throw new ValidationError('Choose one of your categories.', { details: { fieldErrors: { categoryId: ['Choose one of your categories.'] } } })
      }
      await queries.updateTransaction(ctx, tx, { transactionId: token.entityId, categoryId: category.id })
      return `Filed under ${category.name}.`
    }

    if (dueOn === null) throw new ValidationError('This link isn’t valid.')
    const { timezone } = await queries.getHousehold(ctx, tx)
    await queries.markBillPaid(ctx, tx, { billId: token.entityId, dueOn, paidOn: todayInTimeZone(timezone, deps.now) })
    return 'Marked paid.'
  })
}

function refusal(view: OneTapView): Error {
  switch (view.state) {
    case 'used':
      return new ConflictError('This link has already been used.')
    case 'expired':
      return new ValidationError('This link has expired. Open Ghar to make the change.')
    case 'not_allowed':
      return new ValidationError('Your role in the household no longer lets you change this.')
    default:
      return new ValidationError('This link isn’t valid.')
  }
}
