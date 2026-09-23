import type { CalendarDate } from '@ghar/core/dates'
import { and, eq, gte, inArray, lte } from 'drizzle-orm'
import { authUsers } from 'drizzle-orm/supabase'
import { assets, documents, expiryReminders, householdMembers, households, profiles, renewals } from '../schema'
import { authorize } from './authorize'
import type { Actor, Db } from './types'

// Reminder emails for things that run out, sent by the daily job across every household. Each
// email is claimed with a row before it goes out, so a job that runs twice, or two runs at once,
// can't send the same reminder twice.

export interface ReminderHousehold {
  id: string
  name: string
  timezone: string
}

/** Every household. Ghar holds one family, so the scan is short. */
export async function listHouseholdsForReminders(db: Db): Promise<ReminderHousehold[]> {
  return db.select({ id: households.id, name: households.name, timezone: households.timezone }).from(households)
}

export interface ExpirySubject {
  kind: 'document' | 'warranty' | 'renewal'
  /** The document's id, the asset's for a warranty, or the renewal's. */
  id: string
  title: string
  expiresOn: CalendarDate
  /** A renewal that renews on its own. */
  autoRenews?: boolean
}

/** Documents, sensitive ones included, warranties and renewals that run out from `from` through `to`. */
export async function listExpiriesForReminders(
  actor: Actor,
  db: Db,
  range: { from: CalendarDate; to: CalendarDate }
): Promise<ExpirySubject[]> {
  authorize(actor, 'documents.viewSensitive')
  const [documentRows, assetRows, renewalRows] = await Promise.all([
    db
      .select({ id: documents.id, title: documents.title, expiresOn: documents.expiresOn })
      .from(documents)
      .where(
        and(
          eq(documents.householdId, actor.householdId),
          gte(documents.expiresOn, range.from),
          lte(documents.expiresOn, range.to)
        )
      ),
    db
      .select({ id: assets.id, title: assets.name, expiresOn: assets.warrantyExpiresOn })
      .from(assets)
      .where(
        and(
          eq(assets.householdId, actor.householdId),
          gte(assets.warrantyExpiresOn, range.from),
          lte(assets.warrantyExpiresOn, range.to)
        )
      ),
    db
      .select({ id: renewals.id, title: renewals.title, expiresOn: renewals.expiresOn, autoRenews: renewals.autoRenews })
      .from(renewals)
      .where(
        and(eq(renewals.householdId, actor.householdId), gte(renewals.expiresOn, range.from), lte(renewals.expiresOn, range.to))
      ),
  ])
  const subjects: ExpirySubject[] = []
  for (const row of documentRows) if (row.expiresOn !== null) subjects.push({ kind: 'document', ...row, expiresOn: row.expiresOn })
  for (const row of assetRows) if (row.expiresOn !== null) subjects.push({ kind: 'warranty', ...row, expiresOn: row.expiresOn })
  for (const row of renewalRows) subjects.push({ kind: 'renewal', ...row })
  return subjects.toSorted((a, b) => a.expiresOn.localeCompare(b.expiresOn) || a.title.localeCompare(b.title))
}

/**
 * Claims one reminder tier for one expiry date. Returns the claim's id, or null when that reminder
 * was already sent. A renewed document, or a renewal whose date moved on, has a new expiry date,
 * so its reminders start over.
 */
export async function claimExpiryReminder(
  actor: Actor,
  db: Db,
  input: { subject: ExpirySubject; thresholdDays: number }
): Promise<string | null> {
  authorize(actor, 'documents.viewSensitive')
  const { subject } = input
  const [claimed] = await db
    .insert(expiryReminders)
    .values({
      householdId: actor.householdId,
      documentId: subject.kind === 'document' ? subject.id : null,
      assetId: subject.kind === 'warranty' ? subject.id : null,
      renewalId: subject.kind === 'renewal' ? subject.id : null,
      thresholdDays: input.thresholdDays,
      expiresOn: subject.expiresOn,
    })
    .onConflictDoNothing()
    .returning({ id: expiryReminders.id })
  return claimed?.id ?? null
}

/** Gives a claim back when its email couldn't be sent, so tomorrow's run tries again. */
export async function releaseExpiryReminder(actor: Actor, db: Db, reminderId: string): Promise<void> {
  authorize(actor, 'documents.viewSensitive')
  await db
    .delete(expiryReminders)
    .where(and(eq(expiryReminders.id, reminderId), eq(expiryReminders.householdId, actor.householdId)))
}

export interface ReminderRecipient {
  userId: string
  email: string
  fullName: string | null
}

/** Owners and adults: the people who can see every document a reminder could be about. */
export async function listReminderRecipients(actor: Actor, db: Db): Promise<ReminderRecipient[]> {
  authorize(actor, 'documents.viewSensitive')
  const rows = await db
    .select({ userId: householdMembers.userId, email: authUsers.email, fullName: profiles.fullName })
    .from(householdMembers)
    .innerJoin(profiles, eq(profiles.id, householdMembers.userId))
    .leftJoin(authUsers, eq(authUsers.id, householdMembers.userId))
    .where(and(eq(householdMembers.householdId, actor.householdId), inArray(householdMembers.role, ['owner', 'adult'])))
    .orderBy(householdMembers.joinedAt)
  return rows.flatMap(row => (row.email === null ? [] : [{ userId: row.userId, email: row.email, fullName: row.fullName }]))
}
