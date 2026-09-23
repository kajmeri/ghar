import 'server-only'
import type { Expiry, PageQuery, Renewal, RenewalBody, RenewExpiryBody } from '@ghar/contracts'
import { todayInTimeZone, type CalendarDate } from '@ghar/core/dates'
import { expiryState } from '@ghar/core/documents'
import { reminderLeadDays, suggestedRenewalDate, type ExpirySubjectKind } from '@ghar/core/expiries'
import * as queries from '@ghar/db/queries'
import type { ExpiryRow, PageRequest, RenewalWithLinksRow } from '@ghar/db/queries'
import { can } from '@ghar/core/auth'
import { ValidationError } from '@ghar/core/errors'
import type { Session } from '@/lib/api/authed'
import { pageRequest, pageResponse, type PageResult } from '@/lib/api/cursor'
import * as contacts from '@/lib/contacts/service'
import { getDb } from '@/lib/db'
import * as documents from '@/lib/documents/service'
import * as home from '@/lib/home/service'

// What the /api/v1/renewals and /api/v1/expiries routes and the renewals pages call. The queries
// decide who sees what; this file turns rows into the contract.

export function toRenewal(row: RenewalWithLinksRow, today: CalendarDate): Renewal {
  const leadDays = reminderLeadDays({ kind: 'renewal', renewalKind: row.kind }, row.remindFromDays)
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    expiresOn: row.expiresOn,
    expiryState: expiryState(row.expiresOn, today, leadDays),
    remindFromDays: row.remindFromDays,
    reminderLeadDays: leadDays,
    cadenceMonths: row.cadenceMonths,
    autoRenews: row.autoRenews,
    costCents: row.costCents,
    provider: row.provider,
    referenceNumber: row.referenceNumber,
    url: row.url,
    contactId: row.contactId,
    contactName: row.contactName,
    assetId: row.assetId,
    assetName: row.assetName,
    documentId: row.documentId,
    documentTitle: row.documentTitle,
    notes: row.notes,
    notRenewing: row.notRenewing,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** The lead time in effect for one row of the list. */
function leadDaysOf(row: ExpiryRow): number {
  switch (row.kind) {
    case 'document':
      return reminderLeadDays({ kind: 'document', documentKind: row.documentKind }, row.remindFromDays)
    case 'warranty':
      return reminderLeadDays({ kind: 'warranty' }, row.remindFromDays)
    case 'renewal':
      return reminderLeadDays({ kind: 'renewal', renewalKind: row.renewalKind }, row.remindFromDays)
  }
}

export function toExpiry(row: ExpiryRow, today: CalendarDate): Expiry {
  const leadDays = leadDaysOf(row)
  const common = {
    title: row.title,
    expiresOn: row.expiresOn,
    state: expiryState(row.expiresOn, today, leadDays),
    reminderLeadDays: leadDays,
    notRenewing: row.notRenewing,
  }
  switch (row.kind) {
    case 'document':
      return {
        kind: 'document',
        documentId: row.id,
        ...common,
        suggestedRenewalOn: suggestedRenewalDate({ expiresOn: row.expiresOn, issuedOn: row.issuedOn }),
        documentKind: row.documentKind,
      }
    case 'warranty':
      return { kind: 'warranty', assetId: row.id, ...common, suggestedRenewalOn: null }
    case 'renewal':
      return {
        kind: 'renewal',
        renewalId: row.id,
        ...common,
        suggestedRenewalOn: suggestedRenewalDate({ expiresOn: row.expiresOn, cadenceMonths: row.cadenceMonths }),
        renewalKind: row.renewalKind,
        autoRenews: row.autoRenews,
        costCents: row.costCents,
      }
  }
}

const householdToday = (session: Session) => todayInTimeZone(session.household.timeZone)

export async function getRenewal(session: Session, renewalId: string): Promise<Renewal> {
  return toRenewal(await queries.getRenewal(session.context, getDb(), renewalId), householdToday(session))
}

export async function createRenewal(session: Session, body: RenewalBody): Promise<Renewal> {
  return toRenewal(await queries.createRenewal(session.context, getDb(), body), householdToday(session))
}

export async function updateRenewal(session: Session, renewalId: string, body: RenewalBody): Promise<Renewal> {
  return toRenewal(await queries.updateRenewal(session.context, getDb(), renewalId, body), householdToday(session))
}

export async function deleteRenewal(session: Session, renewalId: string): Promise<{ renewalId: string }> {
  await queries.deleteRenewal(session.context, getDb(), renewalId)
  return { renewalId }
}

// Renewing, and saying something won't be

interface ExpiryParams {
  kind: ExpirySubjectKind
  subjectId: string
}

const subjectOf = (params: ExpiryParams) => ({ kind: params.kind, id: params.subjectId })

export async function getExpiry(session: Session, params: ExpiryParams): Promise<{ expiry: Expiry }> {
  const row = await queries.getExpiry(session.context, getDb(), subjectOf(params))
  return { expiry: toExpiry(row, householdToday(session)) }
}

/**
 * Moves the date on. A document can bring the scan of the new one, checked the way a new document's
 * file is; the old file goes once the change is saved, and the new one goes if it isn't.
 */
export async function renewExpiry(session: Session, params: ExpiryParams, body: RenewExpiryBody): Promise<{ expiry: Expiry }> {
  const subject = subjectOf(params)
  if (body.storagePath !== undefined && subject.kind !== 'document') {
    throw new ValidationError('Only a document can have a new scan.')
  }
  const file = body.storagePath === undefined ? undefined : await documents.verifyUploadedFile(session, body.storagePath)
  let result: Awaited<ReturnType<typeof queries.renewExpiry>>
  try {
    result = await queries.renewExpiry(session.context, getDb(), { subject, expiresOn: body.expiresOn, issuedOn: body.issuedOn, file })
  } catch (error) {
    if (file) await documents.removeDocumentFile(file.storagePath)
    throw error
  }
  if (result.replacedStoragePath !== null) await documents.removeDocumentFile(result.replacedStoragePath)
  return { expiry: toExpiry(result.expiry, householdToday(session)) }
}

export async function markNotRenewing(session: Session, params: ExpiryParams, body: { expiresOn: CalendarDate }): Promise<{ expiry: Expiry }> {
  const row = await queries.markNotRenewing(session.context, getDb(), { subject: subjectOf(params), expiresOn: body.expiresOn })
  return { expiry: toExpiry(row, householdToday(session)) }
}

export async function clearNotRenewing(session: Session, params: ExpiryParams): Promise<{ expiry: Expiry }> {
  const row = await queries.clearNotRenewing(session.context, getDb(), subjectOf(params))
  return { expiry: toExpiry(row, householdToday(session)) }
}

/** Documents with an expiry date, warranties and renewals, soonest first, a page at a time. */
export async function listExpiriesPage(session: Session, query: PageQuery & { from?: CalendarDate }): Promise<PageResult<Expiry>> {
  const filter = { from: query.from }
  const scope = { sort: 'expiries:expires-asc', filters: filter }
  const request: PageRequest = pageRequest(query, scope)
  const page = await queries.listExpiriesPage(session.context, getDb(), filter, request)
  const today = householdToday(session)
  return pageResponse(page, scope, row => toExpiry(row, today))
}

/** Every expiry from `from` on, for the renewals page. It walks the pages so the page can group them. */
export async function listAllExpiries(session: Session, from?: CalendarDate): Promise<Expiry[]> {
  const db = getDb()
  const today = householdToday(session)
  const rows: ExpiryRow[] = []
  let after: PageRequest['after'] = null
  do {
    const page = await queries.listExpiriesPage(session.context, db, { from }, { after, limit: 200 })
    rows.push(...page.rows)
    after = page.next
  } while (after !== null)
  return rows.map(row => toExpiry(row, today))
}

export interface RenewalFormOptions {
  assets: { id: string; name: string }[]
  contacts: { id: string; name: string }[]
  /** Only the documents the editor can see. */
  documents: { id: string; title: string }[]
}

/** What the renewal form offers to link to. */
export async function listRenewalFormOptions(session: Session): Promise<RenewalFormOptions> {
  const { role } = session.context
  const [assets, people, papers] = await Promise.all([
    can(role, 'home.view') ? home.listAssetOptions(session) : [],
    can(role, 'contacts.view') ? contacts.listContacts(session) : [],
    documents.listDocuments(session),
  ])
  return {
    assets,
    contacts: people.map(contact => ({ id: contact.id, name: contact.name })),
    documents: papers.map(document => ({ id: document.id, title: document.title })),
  }
}
