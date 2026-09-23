import { can, requirePermission, type Permission } from '@ghar/core/auth'
import type { CalendarDate } from '@ghar/core/dates'
import type { DocumentMimeType } from '@ghar/core/documents'
import { ConflictError, NotFoundError, ValidationError } from '@ghar/core/errors'
import { renewalDateProblem, type ExpirySubjectKind } from '@ghar/core/expiries'
import { and, eq, sql, type AnyColumn, type SQL } from 'drizzle-orm'
import { assets, documents, expiryDismissals, renewals } from '../schema'
import type { ExpiryRow } from './renewals'
import type { Db, RequestContext } from './types'

// Renewing something that runs out, or saying it won't be. Renewing moves the date on; reminders are
// claimed per date, so they start over by themselves. "Not renewing" is a row for the one date: it
// stops that date's reminders and takes it off the attention list and the digest, and a new date
// brings it back. A document follows the documents permissions, a warranty the home ones, and a
// renewal the documents ones, as everywhere else.

export interface ExpirySubjectRef {
  kind: ExpirySubjectKind
  /** The document's id, the asset's for a warranty, or the renewal's. */
  id: string
}

const VIEW: Record<ExpirySubjectKind, Permission> = { document: 'documents.view', warranty: 'home.view', renewal: 'documents.view' }
const MANAGE: Record<ExpirySubjectKind, Permission> = { document: 'documents.manage', warranty: 'home.manage', renewal: 'documents.manage' }

const NOT_FOUND = 'That no longer exists, or has no date it runs out.'

const DISMISSAL_COLUMN = {
  document: expiryDismissals.documentId,
  warranty: expiryDismissals.assetId,
  renewal: expiryDismissals.renewalId,
} as const satisfies Record<ExpirySubjectKind, AnyColumn>

/**
 * Whether someone said the thing in this row won't be renewed, for the date the row has now. For a
 * select list: pass the subject's id column and its expiry date column.
 */
export function notRenewingSql(kind: ExpirySubjectKind, id: AnyColumn, expiresOn: AnyColumn): SQL<boolean> {
  const column = DISMISSAL_COLUMN[kind]
  // Nested so it stays qualified: in a select from one table, Drizzle drops the table name from
  // columns at the top of a field, which would leave `id` meaning the dismissal's own id.
  const subquery = sql`select 1 from ${expiryDismissals} where ${column} = ${id} and ${expiryDismissals.expiresOn} = ${expiresOn}`
  return sql<boolean>`exists (${subquery})`
}

function visibleDocument(ctx: RequestContext): SQL | undefined {
  return can(ctx.role, 'documents.viewSensitive') ? undefined : eq(documents.isSensitive, false)
}

/** One thing that runs out, as the list shows it. Not found when it's gone, hidden from the caller, or has no date. */
export async function getExpiry(ctx: RequestContext, db: Db, subject: ExpirySubjectRef): Promise<ExpiryRow> {
  requirePermission(ctx, VIEW[subject.kind])
  switch (subject.kind) {
    case 'document': {
      const [row] = await db
        .select({
          id: documents.id,
          title: documents.title,
          expiresOn: documents.expiresOn,
          issuedOn: documents.issuedOn,
          documentKind: documents.kind,
          remindFromDays: documents.remindFromDays,
          notRenewing: notRenewingSql('document', documents.id, documents.expiresOn),
        })
        .from(documents)
        .where(and(eq(documents.id, subject.id), eq(documents.householdId, ctx.householdId), visibleDocument(ctx)))
        .limit(1)
      if (!row || row.expiresOn === null) throw new NotFoundError(NOT_FOUND)
      return { kind: 'document', ...row, expiresOn: row.expiresOn }
    }
    case 'warranty': {
      const [row] = await db
        .select({
          id: assets.id,
          title: assets.name,
          expiresOn: assets.warrantyExpiresOn,
          remindFromDays: assets.warrantyRemindFromDays,
          notRenewing: notRenewingSql('warranty', assets.id, assets.warrantyExpiresOn),
        })
        .from(assets)
        .where(and(eq(assets.id, subject.id), eq(assets.householdId, ctx.householdId)))
        .limit(1)
      if (!row || row.expiresOn === null) throw new NotFoundError(NOT_FOUND)
      return { kind: 'warranty', ...row, expiresOn: row.expiresOn }
    }
    case 'renewal': {
      const [row] = await db
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
        })
        .from(renewals)
        .where(and(eq(renewals.id, subject.id), eq(renewals.householdId, ctx.householdId)))
        .limit(1)
      if (!row) throw new NotFoundError(NOT_FOUND)
      return { kind: 'renewal', ...row }
    }
  }
}

/** The date it runs out now, locked until the transaction ends so a renewal and a dismissal can't cross. */
async function lockExpiresOn(ctx: RequestContext, tx: Db, subject: ExpirySubjectRef): Promise<{ expiresOn: CalendarDate; storagePath: string | null }> {
  switch (subject.kind) {
    case 'document': {
      const [row] = await tx
        .select({ expiresOn: documents.expiresOn, storagePath: documents.storagePath })
        .from(documents)
        .where(and(eq(documents.id, subject.id), eq(documents.householdId, ctx.householdId), visibleDocument(ctx)))
        .for('update')
      if (!row || row.expiresOn === null) throw new NotFoundError(NOT_FOUND)
      return { expiresOn: row.expiresOn, storagePath: row.storagePath }
    }
    case 'warranty': {
      const [row] = await tx
        .select({ expiresOn: assets.warrantyExpiresOn })
        .from(assets)
        .where(and(eq(assets.id, subject.id), eq(assets.householdId, ctx.householdId)))
        .for('update')
      if (!row || row.expiresOn === null) throw new NotFoundError(NOT_FOUND)
      return { expiresOn: row.expiresOn, storagePath: null }
    }
    case 'renewal': {
      const [row] = await tx
        .select({ expiresOn: renewals.expiresOn })
        .from(renewals)
        .where(and(eq(renewals.id, subject.id), eq(renewals.householdId, ctx.householdId)))
        .for('update')
      if (!row) throw new NotFoundError(NOT_FOUND)
      return { expiresOn: row.expiresOn, storagePath: null }
    }
  }
}

/** A renewal's row carries its "not renewing" state to phones, so a change to it counts as a change to the renewal. */
async function touchRenewal(ctx: RequestContext, tx: Db, subject: ExpirySubjectRef): Promise<void> {
  if (subject.kind !== 'renewal') return
  await tx
    .update(renewals)
    .set({ updatedAt: sql`now()` })
    .where(and(eq(renewals.id, subject.id), eq(renewals.householdId, ctx.householdId)))
}

/**
 * Says the thing won't be renewed, for the date the caller saw. When its date has moved since, this
 * refuses rather than dismiss a date nobody looked at. Saying it twice is fine.
 */
export async function markNotRenewing(
  ctx: RequestContext,
  db: Db,
  input: { subject: ExpirySubjectRef; expiresOn: CalendarDate }
): Promise<ExpiryRow> {
  requirePermission(ctx, MANAGE[input.subject.kind])
  const { subject } = input
  return db.transaction(async tx => {
    const current = await lockExpiresOn(ctx, tx, subject)
    if (current.expiresOn !== input.expiresOn) throw new ConflictError('Its date changed since you looked. Reload to see the new one.')
    await tx
      .insert(expiryDismissals)
      .values({
        householdId: ctx.householdId,
        documentId: subject.kind === 'document' ? subject.id : null,
        assetId: subject.kind === 'warranty' ? subject.id : null,
        renewalId: subject.kind === 'renewal' ? subject.id : null,
        expiresOn: current.expiresOn,
        dismissedBy: ctx.userId,
      })
      .onConflictDoNothing()
    await touchRenewal(ctx, tx, subject)
    return getExpiry(ctx, tx, subject)
  })
}

/** Takes "not renewing" back for the date it has now, so its reminders resume. Fine when it wasn't set. */
export async function clearNotRenewing(ctx: RequestContext, db: Db, subject: ExpirySubjectRef): Promise<ExpiryRow> {
  requirePermission(ctx, MANAGE[subject.kind])
  return db.transaction(async tx => {
    const current = await lockExpiresOn(ctx, tx, subject)
    await tx
      .delete(expiryDismissals)
      .where(
        and(
          eq(expiryDismissals.householdId, ctx.householdId),
          eq(DISMISSAL_COLUMN[subject.kind], subject.id),
          eq(expiryDismissals.expiresOn, current.expiresOn)
        )
      )
    await touchRenewal(ctx, tx, subject)
    return getExpiry(ctx, tx, subject)
  })
}

export interface RenewedFile {
  storagePath: string
  mimeType: DocumentMimeType
  sizeBytes: number
}

/**
 * Moves the date on to the new term. A document is replaced by a new one: it takes the new one's
 * issue date, or none, since the old one's would be wrong, and can swap in the new scan. The old
 * file's path comes back so the caller can remove it once this has committed. The new date has to be
 * after the current one.
 */
export async function renewExpiry(
  ctx: RequestContext,
  db: Db,
  input: { subject: ExpirySubjectRef; expiresOn: CalendarDate; issuedOn?: CalendarDate | null; file?: RenewedFile }
): Promise<{ expiry: ExpiryRow; replacedStoragePath: string | null }> {
  const { subject, expiresOn, file } = input
  requirePermission(ctx, MANAGE[subject.kind])
  if (file && subject.kind !== 'document') throw new ValidationError('Only a document can have a new scan.')
  const issuedOn = input.issuedOn ?? null
  if (issuedOn !== null && subject.kind !== 'document') throw new ValidationError('Only a document has an issue date.')
  if (issuedOn !== null && issuedOn > expiresOn) {
    const problem = 'The issue date has to be on or before the new expiry date.'
    throw new ValidationError(problem, { details: { fieldErrors: { issuedOn: [problem] } } })
  }
  return db.transaction(async tx => {
    const current = await lockExpiresOn(ctx, tx, subject)
    const problem = renewalDateProblem(current.expiresOn, expiresOn)
    if (problem) throw new ValidationError(problem, { details: { fieldErrors: { expiresOn: [problem] } } })

    switch (subject.kind) {
      case 'document':
        await tx
          .update(documents)
          .set({ expiresOn, issuedOn, ...file, updatedAt: sql`now()` })
          .where(and(eq(documents.id, subject.id), eq(documents.householdId, ctx.householdId)))
        break
      case 'warranty':
        await tx
          .update(assets)
          .set({ warrantyExpiresOn: expiresOn, updatedAt: sql`now()` })
          .where(and(eq(assets.id, subject.id), eq(assets.householdId, ctx.householdId)))
        break
      case 'renewal':
        await tx
          .update(renewals)
          .set({ expiresOn, updatedAt: sql`now()` })
          .where(and(eq(renewals.id, subject.id), eq(renewals.householdId, ctx.householdId)))
        break
    }
    return {
      expiry: await getExpiry(ctx, tx, subject),
      replacedStoragePath: file && current.storagePath !== file.storagePath ? current.storagePath : null,
    }
  })
}
