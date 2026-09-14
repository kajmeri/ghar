import 'server-only'
import type { CreateDocumentBody, DocumentBody, DocumentUpload, HouseholdDocument } from '@ghar/contracts'
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
import { ValidationError } from '@ghar/core/errors'
import * as queries from '@ghar/db/queries'
import type { DocumentWithAssetRow } from '@ghar/db/queries'
import type { Session } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { getStorageProvider } from '@/lib/providers/storage'

// What the /api/v1/documents routes and the documents pages call. The queries decide who sees
// what, sensitive documents included; this file handles the file: where an upload goes, whether it
// arrived, and a link to read it that stops working in minutes. A storage path never leaves the server.

/** Rows in, contract out. The storage path stays behind. */
export function toDocument(row: DocumentWithAssetRow, today: CalendarDate): HouseholdDocument {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    issuedOn: row.issuedOn,
    expiresOn: row.expiresOn,
    expiryState: row.expiresOn === null ? null : expiryState(row.expiresOn, today),
    issuer: row.issuer,
    referenceNumber: row.referenceNumber,
    assetId: row.assetId,
    assetName: row.assetName,
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
  return (q ? searchDocuments(rows, q) : rows).map(row => toDocument(row, today))
}

export async function getDocument(session: Session, documentId: string): Promise<HouseholdDocument> {
  return toDocument(await queries.getDocument(session.context, getDb(), documentId), householdToday(session))
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

  // Before storage is asked anything, so another household's path is never even looked up.
  if (storagePathHousehold(storagePath) !== context.householdId.toLowerCase()) {
    throw new ValidationError('That upload is not one Ghar made for this household.')
  }

  const file = await getStorageProvider().stat(storagePath)
  if (file === null) throw new ValidationError('The file did not finish uploading. Try adding it again.')
  const { mimeType, sizeBytes } = file
  if (!isDocumentMimeType(mimeType)) {
    await removeFile(storagePath)
    throw new ValidationError('Only photos and PDFs can be stored.')
  }
  if (sizeBytes < 1 || sizeBytes > MAX_DOCUMENT_BYTES) {
    await removeFile(storagePath)
    throw new ValidationError('Files can be up to 20 MB.')
  }

  const row = await queries.createDocument(context, getDb(), { ...fields, storagePath, mimeType, sizeBytes })
  return toDocument(row, householdToday(session))
}

export async function updateDocument(session: Session, documentId: string, body: DocumentBody): Promise<HouseholdDocument> {
  return toDocument(await queries.updateDocument(session.context, getDb(), documentId, body), householdToday(session))
}

export async function deleteDocument(session: Session, documentId: string): Promise<{ documentId: string }> {
  const row = await queries.deleteDocument(session.context, getDb(), documentId)
  await removeFile(row.storagePath)
  return { documentId }
}

/** Reading the row first applies the sensitivity rule: a document the caller can't see is a 404 here too. */
export async function getDocumentFileUrl(session: Session, documentId: string): Promise<{ url: string; expiresAt: string }> {
  const row = await queries.getDocument(session.context, getDb(), documentId)
  const link = await getStorageProvider().createFileUrl(row.storagePath)
  return { url: link.url, expiresAt: link.expiresAt.toISOString() }
}

async function removeFile(path: string): Promise<void> {
  try {
    await getStorageProvider().remove(path)
  } catch (error) {
    // Nothing points at the file any more. A stray object in a private bucket is untidy, not exposed.
    console.error('Could not remove a document file from storage', error)
  }
}
