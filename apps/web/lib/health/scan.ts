import 'server-only'
import type { HealthEvent, HealthScanSaveBody, HealthScanSuggestion } from '@ghar/contracts'
import { requirePermission } from '@ghar/core/auth'
import { todayInTimeZone } from '@ghar/core/dates'
import { ForbiddenError, NotFoundError } from '@ghar/core/errors'
import { suggestionFromHealthScan } from '@ghar/core/health-scan'
import * as queries from '@ghar/db/queries'
import type { Session } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { readFileForScan } from '@/lib/documents/scan'
import { removeDocumentFile, verifyUploadedFile } from '@/lib/documents/service'
import { ScanError } from '@/lib/providers/document-scan'
import { getHealthScanner } from '@/lib/providers/health-scan'
import { listAllHealthEvents, listHealthPeople, toHealthEvent } from './service'

// Reading a vaccine card or a visit summary into records for someone's history. The scan saves
// nothing: its suggestions go back to a person, who unticks and corrects them, and then saves the
// ones they want together. The file becomes a medical document only if they ask to keep it.

/** Whoever the scan is for, if the caller may log for them. Someone they can't see is missing. */
async function requireLoggablePerson(session: Session, personId: string): Promise<void> {
  const person = (await listHealthPeople(session)).find(candidate => candidate.id === personId)
  if (!person) throw new NotFoundError('That person is not in this household.')
  if (!person.canLog) throw new ForbiddenError("Your role in this household doesn't allow this.")
}

/** Null when Claude couldn't read it, or it isn't health paperwork. Either way they log it themselves. */
export async function scanHealthRecord(
  session: Session,
  body: { personId: string; storagePath: string }
): Promise<{ suggestion: HealthScanSuggestion | null }> {
  requirePermission(session.context, 'documents.manage')
  await requireLoggablePerson(session, body.personId)
  const readable = await readFileForScan(await verifyUploadedFile(session, body.storagePath))

  let scan
  try {
    scan = await getHealthScanner().scan(readable)
  } catch (error) {
    if (!(error instanceof ScanError)) throw error
    // The message is always ours, never anything read from the file.
    console.warn(`Reading a health record failed: ${error.message}`)
    return { suggestion: null }
  }
  const logged = await listAllHealthEvents(session, body.personId)
  return { suggestion: suggestionFromHealthScan(scan, { today: todayInTimeZone(session.household.timeZone), logged }) }
}

/**
 * Saves the records the person checked, and the file as a medical document if they're keeping it,
 * in one go: if a record can't be saved, neither is anything else. A file they aren't keeping is
 * deleted once the records are in.
 */
export async function saveHealthScan(
  session: Session,
  body: HealthScanSaveBody
): Promise<{ events: HealthEvent[]; documentId: string | null }> {
  const { context } = session
  requirePermission(context, 'documents.manage')
  const file = await verifyUploadedFile(session, body.storagePath)
  const today = todayInTimeZone(session.household.timeZone)

  const saved = await getDb().transaction(async tx => {
    const document =
      body.keepAs === null
        ? null
        : await queries.createDocument(context, tx, {
            title: body.keepAs.title,
            kind: 'medical',
            issuedOn: null,
            expiresOn: null,
            remindFromDays: null,
            issuer: null,
            referenceNumber: null,
            assetId: null,
            personId: body.personId,
            notes: null,
            // Health paperwork is private: owners and adults can open it, and so can the person it's
            // about. A member only scans their own records, so they may always mark it.
            isSensitive: true,
            ...file,
          })
    const events = await queries.createHealthEvents(
      context,
      tx,
      { personId: body.personId, documentId: document?.id ?? null, events: body.events },
      today
    )
    return { events, documentId: document?.id ?? null }
  })

  if (body.keepAs === null) await removeDocumentFile(body.storagePath)
  return { events: saved.events.map(row => toHealthEvent(row, session)), documentId: saved.documentId }
}
