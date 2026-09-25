import 'server-only'
import type { HealthEvent, HealthEventBody, HealthPerson, PageQuery } from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import { todayInTimeZone } from '@ghar/core/dates'
import { canManageHealthOf } from '@ghar/core/health'
import { comparePeople, personLabel } from '@ghar/core/people'
import * as queries from '@ghar/db/queries'
import type { HealthEventRow, PageRequest } from '@ghar/db/queries'
import type { Session } from '@/lib/api/authed'
import { pageRequest, pageResponse, type PageResult } from '@/lib/api/cursor'
import * as contacts from '@/lib/contacts/service'
import { getDb } from '@/lib/db'
import * as documents from '@/lib/documents/service'

// What the /api/v1/health-records routes and the health pages call. The queries decide who sees
// whose records; this file turns rows into the contract.

const householdToday = (session: Session) => todayInTimeZone(session.household.timeZone)

export function toHealthEvent(row: HealthEventRow, session: Session): HealthEvent {
  const { context } = session
  return {
    id: row.id,
    personId: row.personId,
    personName: personLabel({ id: row.personId, userId: row.personUserId, name: row.personName }, context.userId),
    kind: row.kind,
    title: row.title,
    occurredOn: row.occurredOn,
    contactId: row.contactId,
    contactName: row.contactName,
    documentId: row.documentId,
    documentTitle: row.documentTitle,
    note: row.note,
    canEdit: canManageHealthOf(context, row.personUserId),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** You first, then by name. */
export async function listHealthPeople(session: Session): Promise<HealthPerson[]> {
  const { userId } = session.context
  const rows = await queries.listHealthPeople(session.context, getDb())
  return rows.sort(comparePeople(userId)).map(row => ({
    id: row.id,
    name: personLabel(row, userId),
    canLog: row.canManage,
    eventCount: row.eventCount,
    lastOn: row.lastOn,
  }))
}

export async function listHealthEventsPage(session: Session, query: PageQuery & { personId?: string }): Promise<PageResult<HealthEvent>> {
  const filter = { personId: query.personId }
  const scope = { sort: 'health-events:occurred-desc', filters: filter }
  const request: PageRequest = pageRequest(query, scope)
  const page = await queries.listHealthEventsPage(session.context, getDb(), filter, request)
  return pageResponse(page, scope, row => toHealthEvent(row, session))
}

/** One person's whole history, for their page. A person's records run to dozens, not thousands. */
export async function listAllHealthEvents(session: Session, personId: string): Promise<HealthEvent[]> {
  const db = getDb()
  const rows: HealthEventRow[] = []
  let after: PageRequest['after'] = null
  do {
    const page = await queries.listHealthEventsPage(session.context, db, { personId }, { after, limit: 200 })
    rows.push(...page.rows)
    after = page.next
  } while (after !== null)
  return rows.map(row => toHealthEvent(row, session))
}

export async function getHealthEvent(session: Session, eventId: string): Promise<HealthEvent> {
  return toHealthEvent(await queries.getHealthEvent(session.context, getDb(), eventId), session)
}

export async function createHealthEvent(session: Session, body: HealthEventBody): Promise<HealthEvent> {
  return toHealthEvent(await queries.createHealthEvent(session.context, getDb(), body, householdToday(session)), session)
}

export async function updateHealthEvent(session: Session, eventId: string, body: HealthEventBody): Promise<HealthEvent> {
  return toHealthEvent(await queries.updateHealthEvent(session.context, getDb(), eventId, body, householdToday(session)), session)
}

export async function deleteHealthEvent(session: Session, eventId: string): Promise<{ eventId: string }> {
  await queries.deleteHealthEvent(session.context, getDb(), eventId)
  return { eventId }
}

export interface HealthFormOptions {
  contacts: { id: string; name: string }[]
  /** Only the documents the editor can see. */
  documents: { id: string; title: string }[]
}

/** What the record form offers to link to. */
export async function listHealthFormOptions(session: Session): Promise<HealthFormOptions> {
  const [people, papers] = await Promise.all([
    can(session.context.role, 'contacts.view') ? contacts.listContacts(session) : [],
    documents.listDocuments(session),
  ])
  return {
    contacts: people.map(contact => ({ id: contact.id, name: contact.name })),
    documents: papers.map(document => ({ id: document.id, title: document.title })),
  }
}
