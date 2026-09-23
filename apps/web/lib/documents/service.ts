import 'server-only'
import type { CreateDocumentBody, DocumentBody, DocumentUpload, HouseholdDocument, PageQuery } from '@ghar/contracts'
import { requirePermission } from '@ghar/core/auth'
import { todayInTimeZone, type CalendarDate } from '@ghar/core/dates'
import {
  documentStoragePath,
  expiryState,
  isDocumentMimeType,
  MAX_DOCUMENT_BYTES,
  searchDocuments,
  storagePathHousehold,
  type DocumentKind,
  type DocumentMimeType,
} from '@ghar/core/documents'
import { reminderLeadDays } from '@ghar/core/expiries'
import { ValidationError } from '@ghar/core/errors'
import * as queries from '@ghar/db/queries'
import type { DocumentFile, DocumentWithAssetRow, PageRequest } from '@ghar/db/queries'
import type { Session } from '@/lib/api/authed'
import { collectPage, pageRequest, pageResponse, type PageResult } from '@/lib/api/cursor'
import { getDb } from '@/lib/db'
import { personNameFor } from '@/lib/people/service'
import { getStorageProvider } from '@/lib/providers/storage'

// What the /api/v1/documents routes and the documents pages call. The queries decide who sees
// what, sensitive documents included; this file handles the file: where an upload goes, whether it
// arrived, and a link to read it that stops working in minutes. A storage path never leaves the server.

/** Rows in, contract out. The storage path stays behind. */
export function toDocument(row: DocumentWithAssetRow, today: CalendarDate, currentUserId: string): HouseholdDocument {
  const leadDays = reminderLeadDays({ kind: 'document', documentKind: row.kind }, row.remindFromDays)
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    issuedOn: row.issuedOn,
    expiresOn: row.expiresOn,
    expiryState: row.expiresOn === null ? null : expiryState(row.expiresOn, today, leadDays),
    remindFromDays: row.remindFromDays,
    reminderLeadDays: leadDays,
    issuer: row.issuer,
    referenceNumber: row.referenceNumber,
    assetId: row.assetId,
    assetName: row.assetName,
    personId: row.personId,
    personName: personNameFor(row, currentUserId),
    notes: row.notes,
    uploadedBy: row.uploadedBy,
    isSensitive: row.isSensitive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

const householdToday = (session: Session) => todayInTimeZone(session.household.timeZone)

export async function listDocuments(
  session: Session,
  query: { q?: string; kind?: DocumentKind; assetId?: string } = {}
): Promise<HouseholdDocument[]> {
  const rows = await queries.listDocuments(session.context, getDb(), { kind: query.kind, assetId: query.assetId })
  const q = query.q?.trim()
  const today = householdToday(session)
  return (q ? searchDocuments(rows, q) : rows).map(row => toDocument(row, today, session.context.userId))
}

/** A page of documents for the API, newest first, with the same filters and sensitivity rule as the page. */
export async function listDocumentsPage(
  session: Session,
  query: PageQuery & { q?: string; kind?: DocumentKind; assetId?: string }
): Promise<PageResult<HouseholdDocument>> {
  const db = getDb()
  const q = query.q?.trim() || undefined
  const filter = { kind: query.kind, assetId: query.assetId }
  const scope = { sort: 'documents:created-desc', filters: { ...filter, q } }
  const fetchPage = (request: PageRequest) => queries.listDocumentsPage(session.context, db, filter, request)
  const request = pageRequest(query, scope)
  const page = q ? await collectPage(fetchPage, request, row => searchDocuments([row], q).length > 0) : await fetchPage(request)
  const today = householdToday(session)
  return pageResponse(page, scope, row => toDocument(row, today, session.context.userId))
}

export async function getDocument(session: Session, documentId: string): Promise<HouseholdDocument> {
  return toDocument(await queries.getDocument(session.context, getDb(), documentId), householdToday(session), session.context.userId)
}

/** Step one of adding a document: a fresh path in this household's folder and a link that takes one upload. */
export async function createDocumentUpload(
  session: Session,
  input: { mimeType: DocumentMimeType; sizeBytes: number }
): Promise<DocumentUpload> {
  requirePermission(session.context, 'documents.manage')
  if (input.sizeBytes > MAX_DOCUMENT_BYTES) throw new ValidationError('Files can be up to 20 MB.')
  const storagePath = documentStoragePath(session.context.householdId, crypto.randomUUID(), input.mimeType)
  const link = await getStorageProvider().createUploadUrl(storagePath)
  return { storagePath, uploadUrl: link.url, expiresAt: link.expiresAt.toISOString() }
}

/**
 * Step three: saves the document once its file is in the bucket. The type and size come from
 * storage, not from what the phone said, and a file that breaks the rules is removed.
 */
export async function createDocument(session: Session, body: CreateDocumentBody): Promise<HouseholdDocument> {
  const { context } = session
  requirePermission(context, 'documents.manage')
  const { storagePath, ...fields } = body
  const file = await verifyUploadedFile(session, storagePath)
  const row = await queries.createDocument(context, getDb(), { ...fields, ...file })
  return toDocument(row, householdToday(session), session.context.userId)
}

/**
 * Checks a file an upload link put in the bucket: that the path is one Ghar made for this household,
 * that something arrived, and that it's a photo or PDF within the size limit. A file that breaks the
 * rules is removed. The type and size come from storage, not from what the phone said.
 */
export async function verifyUploadedFile(session: Session, storagePath: string): Promise<DocumentFile> {
  // Before storage is asked anything, so another household's path is never even looked up.
  if (storagePathHousehold(storagePath) !== session.context.householdId.toLowerCase()) {
    throw new ValidationError('That upload is not one Ghar made for this household.')
  }

  const file = await getStorageProvider().stat(storagePath)
  if (file === null) throw new ValidationError('The file did not finish uploading. Try adding it again.')
  const { mimeType, sizeBytes } = file
  if (!isDocumentMimeType(mimeType)) {
    await removeDocumentFile(storagePath)
    throw new ValidationError('Only photos and PDFs can be stored.')
  }
  if (sizeBytes < 1 || sizeBytes > MAX_DOCUMENT_BYTES) {
    await removeDocumentFile(storagePath)
    throw new ValidationError('Files can be up to 20 MB.')
  }
  return { storagePath, mimeType, sizeBytes }
}

export async function updateDocument(session: Session, documentId: string, body: DocumentBody): Promise<HouseholdDocument> {
  return toDocument(await queries.updateDocument(session.context, getDb(), documentId, body), householdToday(session), session.context.userId)
}

export async function deleteDocument(session: Session, documentId: string): Promise<{ documentId: string }> {
  const row = await queries.deleteDocument(session.context, getDb(), documentId)
  await removeDocumentFile(row.storagePath)
  return { documentId }
}

/** Reading the row first applies the sensitivity rule: a document the caller can't see is a 404 here too. */
export async function getDocumentFileUrl(session: Session, documentId: string): Promise<{ url: string; expiresAt: string }> {
  const row = await queries.getDocument(session.context, getDb(), documentId)
  const link = await getStorageProvider().createFileUrl(row.storagePath)
  return { url: link.url, expiresAt: link.expiresAt.toISOString() }
}

/** Once nothing points at it. Never throws: a stray object in a private bucket is untidy, not exposed. */
export async function removeDocumentFile(path: string): Promise<void> {
  try {
    await getStorageProvider().remove(path)
  } catch (error) {
    // Nothing points at the file any more. A stray object in a private bucket is untidy, not exposed.
    console.error('Could not remove a document file from storage', error)
  }
}
