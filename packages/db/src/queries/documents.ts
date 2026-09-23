import { can, requirePermission } from '@ghar/core/auth'
import type { CalendarDate } from '@ghar/core/dates'
import { storagePathHousehold, type DocumentKind, type DocumentMimeType } from '@ghar/core/documents'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@ghar/core/errors'
import { and, count, desc, eq, getTableColumns, gte, isNotNull, lte, sql } from 'drizzle-orm'
import { assets, documents } from '../schema'
import { recordAudit } from './audit'
import { notRenewingSql } from './expiries'
import { keysetAfter, keysetOrder, pageKeys, toPage, type Keyset, type Page, type PageRequest } from './pagination'
import { isUniqueViolation } from './pg-errors'
import type { Db, RequestContext } from './types'

// The household's paperwork. A sensitive document (a passport, a medical record) doesn't exist
// for a member or a viewer: every read here filters it out, and asking for one by id is a 404.
// The file itself lives in a private bucket; only its path is stored, and it never leaves the server.

export type DocumentRow = typeof documents.$inferSelect
export type DocumentWithAssetRow = DocumentRow & { assetName: string | null }

export interface DocumentInput {
  title: string
  kind: DocumentKind
  issuedOn: CalendarDate | null
  expiresOn: CalendarDate | null
  issuer: string | null
  referenceNumber: string | null
  assetId: string | null
  notes: string | null
  isSensitive: boolean
}

/** The uploaded file, as the storage provider reported it. Never as the client claimed. */
export interface DocumentFile {
  storagePath: string
  mimeType: DocumentMimeType
  sizeBytes: number
}

const DOCUMENT_NOT_FOUND = 'That document no longer exists.'

/** The documents the caller's role may see. */
function visibleTo(ctx: RequestContext) {
  const inHousehold = eq(documents.householdId, ctx.householdId)
  return can(ctx.role, 'documents.viewSensitive') ? inHousehold : and(inHousehold, eq(documents.isSensitive, false))
}

function assertCanMarkSensitive(ctx: RequestContext, isSensitive: boolean): void {
  if (isSensitive && !can(ctx.role, 'documents.viewSensitive')) {
    throw new ForbiddenError('Only owners and adults can mark a document sensitive.')
  }
}

async function requireAssetInHousehold(ctx: RequestContext, db: Db, assetId: string): Promise<void> {
  const [asset] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.householdId, ctx.householdId)))
    .limit(1)
  if (!asset) throw new ValidationError('That asset is not in the household.')
}

const documentWithAssetColumns = { ...getTableColumns(documents), assetName: assets.name }

/** Newest first. */
export async function listDocuments(
  ctx: RequestContext,
  db: Db,
  filter: { kind?: DocumentKind; assetId?: string } = {}
): Promise<DocumentWithAssetRow[]> {
  requirePermission(ctx, 'documents.view')
  return db
    .select(documentWithAssetColumns)
    .from(documents)
    .leftJoin(assets, eq(assets.id, documents.assetId))
    .where(
      and(
        visibleTo(ctx),
        filter.kind === undefined ? undefined : eq(documents.kind, filter.kind),
        filter.assetId === undefined ? undefined : eq(documents.assetId, filter.assetId)
      )
    )
    .orderBy(desc(documents.createdAt), desc(documents.id))
}

const documentOrder: Keyset = { keys: [{ expr: documents.createdAt, kind: 'timestamp', desc: true }], id: documents.id, idDesc: true }

/** One page of listDocuments, in the same order and with the same sensitivity rule. */
export async function listDocumentsPage(
  ctx: RequestContext,
  db: Db,
  filter: { kind?: DocumentKind; assetId?: string },
  page: PageRequest
): Promise<Page<DocumentWithAssetRow>> {
  requirePermission(ctx, 'documents.view')
  const rows = await db
    .select({ ...documentWithAssetColumns, pageKeys: pageKeys(documentOrder) })
    .from(documents)
    .leftJoin(assets, eq(assets.id, documents.assetId))
    .where(
      and(
        visibleTo(ctx),
        filter.kind === undefined ? undefined : eq(documents.kind, filter.kind),
        filter.assetId === undefined ? undefined : eq(documents.assetId, filter.assetId),
        keysetAfter(documentOrder, page.after)
      )
    )
    .orderBy(...keysetOrder(documentOrder))
    .limit(page.limit + 1)
  return toPage(rows, page.limit)
}

export async function getDocument(ctx: RequestContext, db: Db, documentId: string): Promise<DocumentWithAssetRow> {
  requirePermission(ctx, 'documents.view')
  const [document] = await db
    .select(documentWithAssetColumns)
    .from(documents)
    .leftJoin(assets, eq(assets.id, documents.assetId))
    .where(and(eq(documents.id, documentId), visibleTo(ctx)))
    .limit(1)
  if (!document) throw new NotFoundError(DOCUMENT_NOT_FOUND)
  return document
}

/**
 * Saves a document for a file already in the bucket. The path has to be one Ghar made for this
 * household, so nobody can claim another household's upload by guessing at its path.
 */
export async function createDocument(ctx: RequestContext, db: Db, input: DocumentInput & DocumentFile): Promise<DocumentWithAssetRow> {
  requirePermission(ctx, 'documents.manage')
  assertCanMarkSensitive(ctx, input.isSensitive)
  if (storagePathHousehold(input.storagePath) !== ctx.householdId) {
    throw new ValidationError("That upload isn't one of this household's. Upload the file again.")
  }
  if (input.assetId !== null) await requireAssetInHousehold(ctx, db, input.assetId)

  try {
    const [document] = await db
      .insert(documents)
      .values({ householdId: ctx.householdId, uploadedBy: ctx.userId, ...input })
      .returning({ id: documents.id })
    if (!document) throw new Error('The document was not created')
    return await getDocument(ctx, db, document.id)
  } catch (error) {
    if (isUniqueViolation(error, 'documents_storage_path_unique')) {
      throw new ConflictError('That file is already saved as a document.')
    }
    throw error
  }
}

/** Replaces every field but the file. */
export async function updateDocument(
  ctx: RequestContext,
  db: Db,
  documentId: string,
  input: DocumentInput
): Promise<DocumentWithAssetRow> {
  requirePermission(ctx, 'documents.manage')
  assertCanMarkSensitive(ctx, input.isSensitive)
  if (input.assetId !== null) await requireAssetInHousehold(ctx, db, input.assetId)

  return db.transaction(async tx => {
    const [updated] = await tx
      .update(documents)
      .set({ ...input, updatedAt: sql`now()` })
      .where(and(eq(documents.id, documentId), visibleTo(ctx)))
      .returning({ id: documents.id })
    if (!updated) throw new NotFoundError(DOCUMENT_NOT_FOUND)
    return getDocument(ctx, tx, documentId)
  })
}

/** Removes the row and hands back its storage path, so the caller can delete the file too. */
export async function deleteDocument(ctx: RequestContext, db: Db, documentId: string): Promise<DocumentRow> {
  requirePermission(ctx, 'documents.manage')
  return db.transaction(async tx => {
    const [deleted] = await tx
      .delete(documents)
      .where(and(eq(documents.id, documentId), visibleTo(ctx)))
      .returning()
    if (!deleted) throw new NotFoundError(DOCUMENT_NOT_FOUND)
    // The title stays out of the audit log: it can be as sensitive as the document.
    await recordAudit(ctx, tx, {
      action: 'document.deleted',
      entity: 'document',
      entityId: documentId,
      metadata: { kind: deleted.kind, isSensitive: deleted.isSensitive },
    })
    return deleted
  })
}

/** How many documents the caller can see on each asset. Assets with none are left out. */
export async function countDocumentsByAsset(ctx: RequestContext, db: Db): Promise<Map<string, number>> {
  requirePermission(ctx, 'documents.view')
  const rows = await db
    .select({ assetId: documents.assetId, documents: count() })
    .from(documents)
    .where(and(visibleTo(ctx), isNotNull(documents.assetId)))
    .groupBy(documents.assetId)
  const counts = new Map<string, number>()
  for (const row of rows) if (row.assetId !== null) counts.set(row.assetId, row.documents)
  return counts
}

export interface DocumentExpiryRow {
  id: string
  title: string
  kind: DocumentKind
  expiresOn: CalendarDate
  issuedOn: CalendarDate | null
  assetId: string | null
  /** Someone said it won't be renewed, for this date. */
  notRenewing: boolean
}

/** Documents the caller can see that expire from `from` through `to`, soonest first. */
export async function listDocumentExpiries(
  ctx: RequestContext,
  db: Db,
  range: { from: CalendarDate; to: CalendarDate }
): Promise<DocumentExpiryRow[]> {
  requirePermission(ctx, 'documents.view')
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      kind: documents.kind,
      expiresOn: documents.expiresOn,
      issuedOn: documents.issuedOn,
      assetId: documents.assetId,
      notRenewing: notRenewingSql('document', documents.id, documents.expiresOn),
    })
    .from(documents)
    .where(and(visibleTo(ctx), gte(documents.expiresOn, range.from), lte(documents.expiresOn, range.to)))
    .orderBy(documents.expiresOn, documents.title)
  return rows.flatMap(row => (row.expiresOn === null ? [] : [{ ...row, expiresOn: row.expiresOn }]))
}
