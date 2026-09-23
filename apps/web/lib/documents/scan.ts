import 'server-only'
import { requirePermission } from '@ghar/core/auth'
import { isScannableMimeType, MAX_SCAN_IMAGE_BYTES, suggestionFromScan, type DocumentSuggestion } from '@ghar/core/document-scan'
import { isImageMimeType, storagePathHousehold } from '@ghar/core/documents'
import { ConflictError, NotFoundError, ValidationError } from '@ghar/core/errors'
import * as queries from '@ghar/db/queries'
import type { DocumentFile } from '@ghar/db/queries'
import type { Session } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { getDocumentScanner, ScanError } from '@/lib/providers/document-scan'
import { getStorageProvider } from '@/lib/providers/storage'
import { removeDocumentFile, verifyUploadedFile } from './service'

// Reading a document's dates off its file, for the form to suggest. Nothing here saves anything:
// the answer goes back to a person, who checks it and saves it as they would have typed it. A scan
// never reads ID numbers; see @ghar/core/document-scan.

type Scan = { suggestion: DocumentSuggestion | null }

/** A file from createDocumentUpload, before it's a document. */
export async function scanUploadedFile(session: Session, storagePath: string): Promise<Scan> {
  requirePermission(session.context, 'documents.manage')
  const file = await verifyUploadedFile(session, storagePath)
  return { suggestion: await scanFile(file) }
}

/** A saved document's file. One the caller can't see is a 404, as it is everywhere. */
export async function scanSavedDocument(session: Session, documentId: string): Promise<Scan> {
  requirePermission(session.context, 'documents.manage')
  const row = await queries.getDocument(session.context, getDb(), documentId)
  return { suggestion: await scanFile({ storagePath: row.storagePath, mimeType: row.mimeType, sizeBytes: row.sizeBytes }) }
}

/** Null when Claude couldn't read it, or it isn't a document. Either way the person fills the form in themselves. */
async function scanFile(file: DocumentFile): Promise<DocumentSuggestion | null> {
  const { mimeType } = file
  if (!isScannableMimeType(mimeType)) {
    throw new ValidationError('Ghar can’t read the dates on a HEIC photo. Fill them in yourself, or use a JPEG or PDF.')
  }
  if (isImageMimeType(mimeType) && file.sizeBytes > MAX_SCAN_IMAGE_BYTES) {
    throw new ValidationError('That photo is too big for Ghar to read. Fill in the dates yourself.')
  }
  const stored = await getStorageProvider().read(file.storagePath)
  if (stored === null) throw new NotFoundError('That file is missing from storage.')

  try {
    return suggestionFromScan(await getDocumentScanner().scan({ bytes: stored.bytes, mimeType }))
  } catch (error) {
    if (!(error instanceof ScanError)) throw error
    // The message is always ours, never anything read from the file.
    console.warn(`Reading a document scan failed: ${error.message}`)
    return null
  }
}

/**
 * Deletes an upload someone scanned and then didn't save. A file a document keeps is refused,
 * private documents included, so this can't be used to take a saved document's file away.
 */
export async function discardUpload(session: Session, storagePath: string): Promise<{ discarded: true }> {
  const { context } = session
  requirePermission(context, 'documents.manage')
  if (storagePathHousehold(storagePath) !== context.householdId.toLowerCase()) {
    throw new ValidationError('That upload is not one Ghar made for this household.')
  }
  if (await queries.isDocumentFileInUse(context, getDb(), storagePath)) {
    throw new ConflictError('A document keeps that file. Delete the document instead.')
  }
  await removeDocumentFile(storagePath)
  return { discarded: true }
}
