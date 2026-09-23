import { requirePermission } from '@ghar/core/auth'
import type { CalendarDate } from '@ghar/core/dates'
import {
  DEFAULT_DIGEST_PREFERENCES,
  DIGEST_SECTIONS,
  isDigestSection,
  type DigestPreferences,
  type DigestTransaction,
} from '@ghar/core/digest'
import { ValidationError } from '@ghar/core/errors'
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { authUsers } from 'drizzle-orm/supabase'
import { accounts, categories, digestPreferences, digestSends, householdMembers, households, profiles, transactions } from '../schema'
import type { Db, RequestContext, SystemContext } from './types'

// The daily digest: each person's delivery preferences, who it goes to, the claim that stops a day's
// digest going out twice, and the reads only the digest needs. The rest of what it shows comes from
// the queries the app's own pages use, read as the person it's for.

// ---------------------------------------------------------------------------------------------
// Preferences

function fromRow(row: { enabled: boolean; sections: readonly string[]; sendHour: number }): DigestPreferences {
  return { enabled: row.enabled, sections: DIGEST_SECTIONS.filter(section => row.sections.includes(section)), sendHour: row.sendHour }
}

/** The signed-in person's preferences in this household, or the defaults if they never changed them. */
export async function getDigestPreferences(ctx: RequestContext, db: Db): Promise<DigestPreferences> {
  const [row] = await db
    .select({ enabled: digestPreferences.enabled, sections: digestPreferences.sections, sendHour: digestPreferences.sendHour })
    .from(digestPreferences)
    .where(and(eq(digestPreferences.householdId, ctx.householdId), eq(digestPreferences.userId, ctx.userId)))
    .limit(1)
  return row ? fromRow(row) : DEFAULT_DIGEST_PREFERENCES
}

/** Anyone can choose how they get their own digest. Sections their role can't see are kept but never sent. */
export async function setDigestPreferences(ctx: RequestContext, db: Db, input: DigestPreferences): Promise<DigestPreferences> {
  const fieldErrors: Record<string, string[]> = {}
  if (!input.sections.every(section => isDigestSection(section))) fieldErrors.sections = ['Choose from the listed sections.']
  if (!Number.isInteger(input.sendHour) || input.sendHour < 0 || input.sendHour > 23) fieldErrors.sendHour = ['Choose an hour of the day.']
  if (Object.keys(fieldErrors).length > 0) {
    throw new ValidationError('Check the highlighted fields.', { details: { fieldErrors } })
  }

  const values = { enabled: input.enabled, sections: DIGEST_SECTIONS.filter(section => input.sections.includes(section)), sendHour: input.sendHour }
  const [row] = await db
    .insert(digestPreferences)
    .values({ householdId: ctx.householdId, userId: ctx.userId, ...values })
    .onConflictDoUpdate({
      target: [digestPreferences.householdId, digestPreferences.userId],
      set: { ...values, updatedAt: sql`now()` },
    })
    .returning({ enabled: digestPreferences.enabled, sections: digestPreferences.sections, sendHour: digestPreferences.sendHour })
  if (!row) throw new Error('Digest preferences upsert returned no row')
  return fromRow(row)
}

// ---------------------------------------------------------------------------------------------
// Sending

export interface DigestRecipient {
  householdId: string
  householdName: string
  timezone: string
  currency: string
  userId: string
  role: RequestContext['role']
  email: string
  fullName: string | null
  preferences: DigestPreferences
}

/**
 * Every member of every household with an email address, and how they want their digest, turned off
 * or not. Reads across households: only the digest job may call it.
 */
export async function listDigestRecipients(db: Db): Promise<DigestRecipient[]> {
  const rows = await db
    .select({
      householdId: householdMembers.householdId,
      householdName: households.name,
      timezone: households.timezone,
      currency: households.currency,
      userId: householdMembers.userId,
      role: householdMembers.role,
      email: authUsers.email,
      fullName: profiles.fullName,
      enabled: digestPreferences.enabled,
      sections: digestPreferences.sections,
      sendHour: digestPreferences.sendHour,
    })
    .from(householdMembers)
    .innerJoin(households, eq(households.id, householdMembers.householdId))
    .innerJoin(profiles, eq(profiles.id, householdMembers.userId))
    .leftJoin(authUsers, eq(authUsers.id, householdMembers.userId))
    .leftJoin(
      digestPreferences,
      and(eq(digestPreferences.householdId, householdMembers.householdId), eq(digestPreferences.userId, householdMembers.userId))
    )
    .orderBy(asc(householdMembers.householdId), asc(householdMembers.joinedAt), asc(householdMembers.userId))
  return rows.flatMap(({ enabled, sections, sendHour, email, ...row }) =>
    email === null
      ? []
      : [
          {
            ...row,
            email,
            preferences: enabled === null || sections === null || sendHour === null ? DEFAULT_DIGEST_PREFERENCES : fromRow({ enabled, sections, sendHour }),
          },
        ]
  )
}

/**
 * Claims one person's digest for one of the household's days before it's sent. Returns the claim's
 * id, or null when that day's digest already went out.
 */
export async function claimDigestSend(actor: SystemContext, db: Db, input: { userId: string; digestOn: CalendarDate }): Promise<string | null> {
  const [claimed] = await db
    .insert(digestSends)
    .values({ householdId: actor.householdId, userId: input.userId, digestOn: input.digestOn })
    .onConflictDoNothing()
    .returning({ id: digestSends.id })
  return claimed?.id ?? null
}

/** Gives a claim back when the email couldn't be sent, so the next run tries again. */
export async function releaseDigestSend(actor: SystemContext, db: Db, sendId: string): Promise<void> {
  await db.delete(digestSends).where(and(eq(digestSends.id, sendId), eq(digestSends.householdId, actor.householdId)))
}

// ---------------------------------------------------------------------------------------------
// What's in it

/** More than a family's bank syncs bring in on a day. The digest shows a few and counts the rest. */
const AUTO_CATEGORIZED_MAX = 200

/**
 * Transactions that arrived from `since` until `until` and were filed by a rule, the bank's category or
 * the model, not by a person. Excluded ones and those on hidden accounts are left out.
 */
export async function listAutoCategorized(ctx: RequestContext, db: Db, range: { since: Date; until: Date }): Promise<DigestTransaction[]> {
  requirePermission(ctx, 'finances.view')
  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      merchantName: transactions.merchantName,
      name: transactions.name,
      amountCents: transactions.amountCents,
      categoryName: categories.name,
    })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        eq(transactions.householdId, ctx.householdId),
        gte(transactions.createdAt, range.since),
        lt(transactions.createdAt, range.until),
        inArray(transactions.categorySource, ['rule', 'pfc', 'llm']),
        eq(transactions.isExcluded, false),
        or(isNull(accounts.id), eq(accounts.isHidden, false))
      )
    )
    .orderBy(desc(transactions.date), desc(transactions.id))
    .limit(AUTO_CATEGORIZED_MAX)
  return rows.map(({ merchantName, name, ...row }) => ({ ...row, description: merchantName ?? name }))
}
