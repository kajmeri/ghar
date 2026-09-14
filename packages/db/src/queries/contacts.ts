import { requirePermission } from '@ghar/core/auth'
import { normalizeContactTags } from '@ghar/core/contacts'
import { NotFoundError } from '@ghar/core/errors'
import { and, asc, eq, sql } from 'drizzle-orm'
import { contacts } from '../schema'
import { recordAudit } from './audit'
import type { Db, RequestContext } from './types'

// The people the household calls: the plumber, the pediatrician, the insurance agent.

export type ContactRow = typeof contacts.$inferSelect

export interface ContactInput {
  name: string
  role: string | null
  phone: string | null
  email: string | null
  url: string | null
  notes: string | null
  tags: readonly string[]
}

const CONTACT_NOT_FOUND = 'That contact no longer exists.'

function contactKey(ctx: RequestContext, contactId: string) {
  return and(eq(contacts.id, contactId), eq(contacts.householdId, ctx.householdId))
}

/** By name. Searching is done over the whole list, which for one family is short. */
export async function listContacts(ctx: RequestContext, db: Db): Promise<ContactRow[]> {
  requirePermission(ctx, 'contacts.view')
  return db
    .select()
    .from(contacts)
    .where(eq(contacts.householdId, ctx.householdId))
    .orderBy(sql`lower(${contacts.name})`, asc(contacts.id))
}

export async function getContact(ctx: RequestContext, db: Db, contactId: string): Promise<ContactRow> {
  requirePermission(ctx, 'contacts.view')
  const [contact] = await db.select().from(contacts).where(contactKey(ctx, contactId)).limit(1)
  if (!contact) throw new NotFoundError(CONTACT_NOT_FOUND)
  return contact
}

export async function createContact(ctx: RequestContext, db: Db, input: ContactInput): Promise<ContactRow> {
  requirePermission(ctx, 'contacts.manage')
  const [contact] = await db
    .insert(contacts)
    .values({ householdId: ctx.householdId, ...input, tags: normalizeContactTags(input.tags) })
    .returning()
  if (!contact) throw new Error('The contact was not created')
  return contact
}

export async function updateContact(ctx: RequestContext, db: Db, contactId: string, input: ContactInput): Promise<ContactRow> {
  requirePermission(ctx, 'contacts.manage')
  const [contact] = await db
    .update(contacts)
    .set({ ...input, tags: normalizeContactTags(input.tags), updatedAt: sql`now()` })
    .where(contactKey(ctx, contactId))
    .returning()
  if (!contact) throw new NotFoundError(CONTACT_NOT_FOUND)
  return contact
}

/** Maintenance jobs that named the contact keep going without a vendor. */
export async function deleteContact(ctx: RequestContext, db: Db, contactId: string): Promise<void> {
  requirePermission(ctx, 'contacts.manage')
  await db.transaction(async tx => {
    const [deleted] = await tx.delete(contacts).where(contactKey(ctx, contactId)).returning({ name: contacts.name })
    if (!deleted) throw new NotFoundError(CONTACT_NOT_FOUND)
    await recordAudit(ctx, tx, {
      action: 'contact.deleted',
      entity: 'contact',
      entityId: contactId,
      metadata: { name: deleted.name },
    })
  })
}
