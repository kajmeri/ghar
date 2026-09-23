import { can, requirePermission } from '@ghar/core/auth'
import type { CalendarDate } from '@ghar/core/dates'
import type { DocumentKind } from '@ghar/core/documents'
import { NotFoundError, ValidationError } from '@ghar/core/errors'
import { currentTermEnd, type RenewalKind } from '@ghar/core/renewals'
import { and, eq, getTableColumns, gte, isNotNull, lt, lte, not, sql, type SQL } from 'drizzle-orm'
import { assets, contacts, documents, renewals } from '../schema'
import { recordAudit } from './audit'
import { authorize } from './authorize'
import { notRenewingSql } from './expiries'
import { keysetAfter, keysetOrder, pageKeys, toPage, type Keyset, type Page, type PageRequest } from './pagination'
import type { Actor, Db, RequestContext } from './types'

// Renewals, and the one list of everything that runs out. A renewal follows the documents
// permissions: everyone sees them, contributors manage them. It can point at a sensitive document;
// for someone who can't see that document the link reads as no title, and they can't make one.

export type RenewalRow = typeof renewals.$inferSelect
export type RenewalWithLinksRow = RenewalRow & {
  contactName: string | null
  assetName: string | null
  /** Null when the document is gone, or the caller can't see it. */
  documentTitle: string | null
  /** Someone said it won't be renewed, for the date it has now. */
  notRenewing: boolean
}

export interface RenewalInput {
  title: string
  kind: RenewalKind
  expiresOn: CalendarDate
  /** Days before it runs out that reminders start. Null, or left out on create, for the default. */
  remindFromDays?: number | null
  cadenceMonths: number | null
  autoRenews: boolean
  costCents: number | null
  provider: string | null
  referenceNumber: string | null
  url: string | null
  contactId: string | null
  assetId: string | null
  documentId: string | null
  notes: string | null
}

const RENEWAL_NOT_FOUND = 'That renewal no longer exists.'

function renewalKey(ctx: RequestContext, renewalId: string) {
  return and(eq(renewals.id, renewalId), eq(renewals.householdId, ctx.householdId))
}

/** The documents the caller's role may see, as the documents queries decide it. */
function visibleDocuments(ctx: RequestContext): SQL | undefined {
  return can(ctx.role, 'documents.viewSensitive') ? undefined : eq(documents.isSensitive, false)
}

/** A renewal with the names of what it links to, plus any extra columns the caller asks for. */
export function selectRenewalsWithLinks<Extra extends Record<string, SQL>>(ctx: RequestContext, db: Db, extra?: Extra) {
  return db
    .select({
      ...getTableColumns(renewals),
      contactName: contacts.name,
      assetName: assets.name,
      documentTitle: documents.title,
      notRenewing: notRenewingSql('renewal', renewals.id, renewals.expiresOn),
      ...(extra ?? ({} as Extra)),
    })
    .from(renewals)
    .leftJoin(contacts, eq(contacts.id, renewals.contactId))
    .leftJoin(assets, eq(assets.id, renewals.assetId))
    .leftJoin(documents, and(eq(documents.id, renewals.documentId), visibleDocuments(ctx)))
}

async function requireLinksInHousehold(ctx: RequestContext, db: Db, input: RenewalInput): Promise<void> {
  const checks: Promise<void>[] = []
  if (input.contactId !== null) {
    const contactId = input.contactId
    checks.push(
      db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.id, contactId), eq(contacts.householdId, ctx.householdId)))
        .limit(1)
        .then(([row]) => {
          if (!row) throw new ValidationError('That contact is not in the household.')
        })
    )
  }
  if (input.assetId !== null) {
    const assetId = input.assetId
    checks.push(
      db
        .select({ id: assets.id })
        .from(assets)
        .where(and(eq(assets.id, assetId), eq(assets.householdId, ctx.householdId)))
        .limit(1)
        .then(([row]) => {
          if (!row) throw new ValidationError('That asset is not in the household.')
        })
    )
  }
  if (input.documentId !== null) {
    const documentId = input.documentId
    checks.push(
      db
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.id, documentId), eq(documents.householdId, ctx.householdId), visibleDocuments(ctx)))
        .limit(1)
        .then(([row]) => {
          if (!row) throw new ValidationError('That document is not in the household.')
        })
    )
  }
  await Promise.all(checks)
}

export async function getRenewal(ctx: RequestContext, db: Db, renewalId: string): Promise<RenewalWithLinksRow> {
  requirePermission(ctx, 'documents.view')
  const [renewal] = await selectRenewalsWithLinks(ctx, db).where(renewalKey(ctx, renewalId)).limit(1)
  if (!renewal) throw new NotFoundError(RENEWAL_NOT_FOUND)
  return renewal
}

export async function createRenewal(ctx: RequestContext, db: Db, input: RenewalInput): Promise<RenewalWithLinksRow> {
  requirePermission(ctx, 'documents.manage')
  await requireLinksInHousehold(ctx, db, input)
  const [renewal] = await db
    .insert(renewals)
    .values({ householdId: ctx.householdId, ...input })
    .returning({ id: renewals.id })
  if (!renewal) throw new Error('The renewal was not created')
  return getRenewal(ctx, db, renewal.id)
}

/** Replaces every field. */
export async function updateRenewal(ctx: RequestContext, db: Db, renewalId: string, input: RenewalInput): Promise<RenewalWithLinksRow> {
  requirePermission(ctx, 'documents.manage')
  await requireLinksInHousehold(ctx, db, input)
  return db.transaction(async tx => {
    const [updated] = await tx
      .update(renewals)
      .set({ ...input, updatedAt: sql`now()` })
      .where(renewalKey(ctx, renewalId))
      .returning({ id: renewals.id })
    if (!updated) throw new NotFoundError(RENEWAL_NOT_FOUND)
    return getRenewal(ctx, tx, renewalId)
  })
}

/** Its reminders go with it. The document, asset and contact it pointed at stay. */
export async function deleteRenewal(ctx: RequestContext, db: Db, renewalId: string): Promise<void> {
  requirePermission(ctx, 'documents.manage')
  await db.transaction(async tx => {
    const [deleted] = await tx.delete(renewals).where(renewalKey(ctx, renewalId)).returning({ title: renewals.title, kind: renewals.kind })
    if (!deleted) throw new NotFoundError(RENEWAL_NOT_FOUND)
    await recordAudit(ctx, tx, {
      action: 'renewal.deleted',
      entity: 'renewal',
      entityId: renewalId,
      metadata: { title: deleted.title, kind: deleted.kind },
    })
  })
}

export interface RenewalExpiryRow {
  id: string
  title: string
  kind: RenewalKind
  expiresOn: CalendarDate
  autoRenews: boolean
  costCents: number | null
  cadenceMonths: number | null
  remindFromDays: number | null
  /** Someone said it won't be renewed, for this date. */
  notRenewing: boolean
}

/** Renewals whose term ends from `from` through `to`, soonest first. */
export async function listRenewalExpiries(
  ctx: RequestContext,
  db: Db,
  range: { from: CalendarDate; to: CalendarDate }
): Promise<RenewalExpiryRow[]> {
  requirePermission(ctx, 'documents.view')
  return db
    .select({
      id: renewals.id,
      title: renewals.title,
      kind: renewals.kind,
      expiresOn: renewals.expiresOn,
      autoRenews: renewals.autoRenews,
      costCents: renewals.costCents,
      cadenceMonths: renewals.cadenceMonths,
      remindFromDays: renewals.remindFromDays,
      notRenewing: notRenewingSql('renewal', renewals.id, renewals.expiresOn),
    })
    .from(renewals)
    .where(and(eq(renewals.householdId, ctx.householdId), gte(renewals.expiresOn, range.from), lte(renewals.expiresOn, range.to)))
    .orderBy(renewals.expiresOn, renewals.title)
}

// The one list of everything that runs out.

/**
 * `notRenewing`: someone said it won't be renewed, for the date it has now. `remindFromDays`: the
 * lead time picked for it, or null for the default.
 */
export type ExpiryRow =
  | {
      kind: 'document'
      id: string
      title: string
      expiresOn: CalendarDate
      issuedOn: CalendarDate | null
      documentKind: DocumentKind
      remindFromDays: number | null
      notRenewing: boolean
    }
  | { kind: 'warranty'; id: string; title: string; expiresOn: CalendarDate; remindFromDays: number | null; notRenewing: boolean }
  | {
      kind: 'renewal'
      id: string
      title: string
      expiresOn: CalendarDate
      renewalKind: RenewalKind
      autoRenews: boolean
      costCents: number | null
      cadenceMonths: number | null
      remindFromDays: number | null
      notRenewing: boolean
    }

interface Keyed {
  row: ExpiryRow
  pageKeys: (string | null)[]
}

const documentExpiryOrder: Keyset = { keys: [{ expr: documents.expiresOn, kind: 'date' }], id: documents.id }
const warrantyExpiryOrder: Keyset = { keys: [{ expr: assets.warrantyExpiresOn, kind: 'date' }], id: assets.id }
const renewalExpiryOrder: Keyset = { keys: [{ expr: renewals.expiresOn, kind: 'date' }], id: renewals.id }

/** Orders merged rows the way Postgres orders each source: by date, then by id. Both compare as text. */
function compareKeys(a: Keyed, b: Keyed): number {
  for (let index = 0; index < 2; index += 1) {
    const left = a.pageKeys[index] ?? ''
    const right = b.pageKeys[index] ?? ''
    if (left !== right) return left < right ? -1 : 1
  }
  return 0
}

/**
 * One page of documents with an expiry date, warranties and renewals, soonest first and then by id.
 * Each source is read past the cursor and cut to the page size, and the three are merged: the first
 * `limit` rows of the merge are the first `limit` rows of the whole list, whichever sources they
 * came from. A date and an id order the same way as text as they do in Postgres, so the merge
 * agrees with each query's own order.
 */
export async function listExpiriesPage(
  ctx: RequestContext,
  db: Db,
  filter: { from?: CalendarDate },
  page: PageRequest
): Promise<Page<ExpiryRow>> {
  requirePermission(ctx, 'documents.view')
  const take = page.limit + 1
  const from = filter.from

  const [documentRows, warrantyRows, renewalRows] = await Promise.all([
    db
      .select({
        id: documents.id,
        title: documents.title,
        expiresOn: documents.expiresOn,
        issuedOn: documents.issuedOn,
        documentKind: documents.kind,
        remindFromDays: documents.remindFromDays,
        notRenewing: notRenewingSql('document', documents.id, documents.expiresOn),
        pageKeys: pageKeys(documentExpiryOrder),
      })
      .from(documents)
      .where(
        and(
          eq(documents.householdId, ctx.householdId),
          visibleDocuments(ctx),
          isNotNull(documents.expiresOn),
          from === undefined ? undefined : gte(documents.expiresOn, from),
          keysetAfter(documentExpiryOrder, page.after)
        )
      )
      .orderBy(...keysetOrder(documentExpiryOrder))
      .limit(take),
    can(ctx.role, 'home.view')
      ? db
          .select({
            id: assets.id,
            title: assets.name,
            expiresOn: assets.warrantyExpiresOn,
            remindFromDays: assets.warrantyRemindFromDays,
            notRenewing: notRenewingSql('warranty', assets.id, assets.warrantyExpiresOn),
            pageKeys: pageKeys(warrantyExpiryOrder),
          })
          .from(assets)
          .where(
            and(
              eq(assets.householdId, ctx.householdId),
              isNotNull(assets.warrantyExpiresOn),
              from === undefined ? undefined : gte(assets.warrantyExpiresOn, from),
              keysetAfter(warrantyExpiryOrder, page.after)
            )
          )
          .orderBy(...keysetOrder(warrantyExpiryOrder))
          .limit(take)
      : [],
    db
      .select({
        id: renewals.id,
        title: renewals.title,
        expiresOn: renewals.expiresOn,
        renewalKind: renewals.kind,
        autoRenews: renewals.autoRenews,
        costCents: renewals.costCents,
        cadenceMonths: renewals.cadenceMonths,
        remindFromDays: renewals.remindFromDays,
        notRenewing: notRenewingSql('renewal', renewals.id, renewals.expiresOn),
        pageKeys: pageKeys(renewalExpiryOrder),
      })
      .from(renewals)
      .where(
        and(
          eq(renewals.householdId, ctx.householdId),
          from === undefined ? undefined : gte(renewals.expiresOn, from),
          keysetAfter(renewalExpiryOrder, page.after)
        )
      )
      .orderBy(...keysetOrder(renewalExpiryOrder))
      .limit(take),
  ])

  const merged: Keyed[] = [
    ...documentRows.flatMap(({ pageKeys: keys, ...row }) =>
      row.expiresOn === null ? [] : [{ pageKeys: keys, row: { kind: 'document' as const, ...row, expiresOn: row.expiresOn } }]
    ),
    ...warrantyRows.flatMap(({ pageKeys: keys, ...row }) =>
      row.expiresOn === null ? [] : [{ pageKeys: keys, row: { kind: 'warranty' as const, ...row, expiresOn: row.expiresOn } }]
    ),
    ...renewalRows.map(({ pageKeys: keys, ...row }) => ({ pageKeys: keys, row: { kind: 'renewal' as const, ...row } })),
  ]
  const result = toPage(merged.toSorted(compareKeys).slice(0, take), page.limit)
  return { ...result, rows: result.rows.map(({ row }) => row) }
}

/**
 * Moves every automatic renewal whose date has passed on to the end of its current term. Safe to
 * run again: a moved date is today or later, and each update only applies to the date it read.
 * One marked not renewing stays where it is: it lapsed on purpose. Returns how many moved.
 */
export async function rollForwardRenewals(actor: Actor, db: Db, today: CalendarDate): Promise<number> {
  authorize(actor, 'documents.manage')
  const lapsed = await db
    .select({ id: renewals.id, expiresOn: renewals.expiresOn, cadenceMonths: renewals.cadenceMonths })
    .from(renewals)
    .where(
      and(
        eq(renewals.householdId, actor.householdId),
        eq(renewals.autoRenews, true),
        lt(renewals.expiresOn, today),
        not(notRenewingSql('renewal', renewals.id, renewals.expiresOn))
      )
    )

  let moved = 0
  for (const row of lapsed) {
    const next = currentTermEnd({ ...row, autoRenews: true }, today)
    if (next === row.expiresOn) continue
    const updated = await db
      .update(renewals)
      .set({ expiresOn: next, updatedAt: sql`now()` })
      .where(and(eq(renewals.id, row.id), eq(renewals.householdId, actor.householdId), eq(renewals.expiresOn, row.expiresOn)))
      .returning({ id: renewals.id })
    moved += updated.length
  }
  return moved
}
