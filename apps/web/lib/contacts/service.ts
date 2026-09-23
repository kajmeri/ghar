import 'server-only'
import type { Contact, ContactBody, ContactJob, PageQuery } from '@ghar/contracts'
import { searchContacts } from '@ghar/core/contacts'
import { todayInTimeZone } from '@ghar/core/dates'
import { maintenanceState } from '@ghar/core/home'
import * as queries from '@ghar/db/queries'
import type { ContactRow, PageRequest } from '@ghar/db/queries'
import type { Session } from '@/lib/api/authed'
import { collectPage, pageRequest, pageResponse, type PageResult } from '@/lib/api/cursor'
import { getDb } from '@/lib/db'

// The plumber, the pediatrician, the insurance agent. What the /api/v1/contacts routes and the
// contacts pages call.

export function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    phone: row.phone,
    email: row.email,
    url: row.url,
    notes: row.notes,
    tags: row.tags,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listContacts(session: Session, query: { q?: string } = {}): Promise<Contact[]> {
  const rows = await queries.listContacts(session.context, getDb())
  const q = query.q?.trim()
  return (q ? searchContacts(rows, q) : rows).map(toContact)
}

/**
 * A page of contacts for the API, by name. Matches for `q` stay in name order so pages hold still;
 * putting names that start with the first word first needs the whole list, so only the page does it.
 */
export async function listContactsPage(session: Session, query: PageQuery & { q?: string }): Promise<PageResult<Contact>> {
  const db = getDb()
  const q = query.q?.trim() || undefined
  const scope = { sort: 'contacts:name', filters: { q } }
  const fetchPage = (request: PageRequest) => queries.listContactsPage(session.context, db, request)
  const request = pageRequest(query, scope)
  const page = q ? await collectPage(fetchPage, request, row => searchContacts([row], q).length > 0) : await fetchPage(request)
  return pageResponse(page, scope, toContact)
}

/** The contact, and the maintenance jobs they're the vendor for. */
export async function getContactDetail(session: Session, contactId: string): Promise<{ contact: Contact; jobs: ContactJob[] }> {
  const { context } = session
  const db = getDb()
  const [contact, tasks] = await Promise.all([
    queries.getContact(context, db, contactId),
    queries.listMaintenanceTasks(context, db, { vendorContactId: contactId }),
  ])
  const today = todayInTimeZone(session.household.timeZone)
  return {
    contact: toContact(contact),
    jobs: tasks.map(task => ({
      id: task.id,
      title: task.title,
      assetId: task.assetId,
      assetName: task.assetName,
      nextDueOn: task.nextDueOn,
      state: maintenanceState(task.nextDueOn, today),
    })),
  }
}

export async function createContact(session: Session, body: ContactBody): Promise<Contact> {
  return toContact(await queries.createContact(session.context, getDb(), body))
}

export async function updateContact(session: Session, contactId: string, body: ContactBody): Promise<Contact> {
  return toContact(await queries.updateContact(session.context, getDb(), contactId, body))
}

export async function deleteContact(session: Session, contactId: string): Promise<{ contactId: string }> {
  await queries.deleteContact(session.context, getDb(), contactId)
  return { contactId }
}
