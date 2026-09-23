import { requirePermission } from '@ghar/core/auth'
import { NotFoundError, ValidationError } from '@ghar/core/errors'
import { normalizePersonName } from '@ghar/core/people'
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import { authUsers } from 'drizzle-orm/supabase'
import { householdPeople, profiles } from '../schema'
import { recordAudit } from './audit'
import type { Db, RequestContext } from './types'

// The household's people: every member, plus anyone without an account who things belong to.
// Members get their row when they join and keep it, frozen under the name they had, when they
// leave. Only people without an account can be added, renamed or removed here; a member's name
// is on their profile, and removing a member is its own thing.

export interface PersonRow {
  id: string
  /** Null for someone without an account. */
  userId: string | null
  /** Their own name, or their profile's. Null for a member who hasn't set one. */
  name: string | null
  createdAt: Date
  updatedAt: Date
}

const PERSON_NOT_FOUND = 'That person is no longer in the household.'

/** A person's name, wherever it lives. For a select list; needs profiles joined on the person's account. */
const personNameSql: SQL<string | null> = sql<string | null>`coalesce(${householdPeople.name}, ${profiles.fullName})`

/**
 * Whose a document or renewal is, for its select list. Needs household_people left-joined on the
 * row's person_id, and profiles on the person's account.
 */
export const personRefColumns = { personName: personNameSql, personUserId: householdPeople.userId }

const personColumns = {
  id: householdPeople.id,
  userId: householdPeople.userId,
  name: personNameSql,
  createdAt: householdPeople.createdAt,
  updatedAt: householdPeople.updatedAt,
}

function selectPeople(db: Db) {
  return db.select(personColumns).from(householdPeople).leftJoin(profiles, eq(profiles.id, householdPeople.userId))
}

/** Oldest first. Callers sort for display with comparePeople. */
export async function listPeople(ctx: RequestContext, db: Db): Promise<PersonRow[]> {
  requirePermission(ctx, 'members.view')
  return selectPeople(db)
    .where(eq(householdPeople.householdId, ctx.householdId))
    .orderBy(asc(householdPeople.createdAt), asc(householdPeople.id))
}

export async function getPerson(ctx: RequestContext, db: Db, personId: string): Promise<PersonRow> {
  requirePermission(ctx, 'members.view')
  const [person] = await selectPeople(db)
    .where(and(eq(householdPeople.id, personId), eq(householdPeople.householdId, ctx.householdId)))
    .limit(1)
  if (!person) throw new NotFoundError(PERSON_NOT_FOUND)
  return person
}

/** Someone without an account: a child, a grandparent who comes on trips. */
export async function createPerson(ctx: RequestContext, db: Db, input: { name: string }): Promise<PersonRow> {
  requirePermission(ctx, 'people.manage')
  const name = normalizePersonName(input.name)
  return db.transaction(async tx => {
    const [person] = await tx.insert(householdPeople).values({ householdId: ctx.householdId, name }).returning({ id: householdPeople.id })
    if (!person) throw new Error('The person was not created')
    await recordAudit(ctx, tx, { action: 'person.created', entity: 'person', entityId: person.id })
    return getPerson(ctx, tx, person.id)
  })
}

/** Only for someone without an account. A member changes their own name on their profile. */
export async function renamePerson(ctx: RequestContext, db: Db, personId: string, input: { name: string }): Promise<PersonRow> {
  requirePermission(ctx, 'people.manage')
  const name = normalizePersonName(input.name)
  return db.transaction(async tx => {
    const [person] = await tx
      .update(householdPeople)
      .set({ name })
      .where(and(eq(householdPeople.id, personId), eq(householdPeople.householdId, ctx.householdId), isNull(householdPeople.userId)))
      .returning({ id: householdPeople.id })
    if (!person) await refuseMember(ctx, tx, personId, 'Members change their own name on their profile.')
    return getPerson(ctx, tx, personId)
  })
}

/**
 * Only for someone without an account. Their documents and renewals stay, belonging to nobody, and
 * they come off every trip.
 */
export async function deletePerson(ctx: RequestContext, db: Db, personId: string): Promise<{ id: string }> {
  requirePermission(ctx, 'people.manage')
  return db.transaction(async tx => {
    const [person] = await tx
      .delete(householdPeople)
      .where(and(eq(householdPeople.id, personId), eq(householdPeople.householdId, ctx.householdId), isNull(householdPeople.userId)))
      .returning({ id: householdPeople.id })
    if (!person) await refuseMember(ctx, tx, personId, 'To take a member out of the household, remove them under Members.')
    await recordAudit(ctx, tx, { action: 'person.deleted', entity: 'person', entityId: personId })
    return { id: personId }
  })
}

/** Throws: the person is a member, so `reason`, or isn't in the household at all. */
async function refuseMember(ctx: RequestContext, db: Db, personId: string, reason: string): Promise<never> {
  const [member] = await db
    .select({ id: householdPeople.id })
    .from(householdPeople)
    .where(and(eq(householdPeople.id, personId), eq(householdPeople.householdId, ctx.householdId)))
    .limit(1)
  throw member ? new ValidationError(reason) : new NotFoundError(PERSON_NOT_FOUND)
}

/**
 * Every person named has to be in the caller's household. A person id from a request body is never
 * trusted on its own.
 */
export async function requireHouseholdPeople(ctx: RequestContext, db: Db, personIds: readonly string[]): Promise<void> {
  const wanted = [...new Set(personIds)]
  if (wanted.length === 0) return
  const found = await db
    .select({ id: householdPeople.id })
    .from(householdPeople)
    .where(and(eq(householdPeople.householdId, ctx.householdId), inArray(householdPeople.id, wanted)))
  if (found.length !== wanted.length) throw new ValidationError('Everyone you pick has to be in the household.')
}

/** The caller's own person. Every member has one from the moment they join. */
export async function requireOwnPerson(ctx: RequestContext, db: Db): Promise<string> {
  const [person] = await db
    .select({ id: householdPeople.id })
    .from(householdPeople)
    .where(and(eq(householdPeople.userId, ctx.userId), eq(householdPeople.householdId, ctx.householdId)))
    .limit(1)
  if (!person) throw new Error('A member has no person row')
  return person.id
}

/** Adds a joining member as one of the household's people. Part of joining; takes no permission. */
export async function addMemberPerson(db: Db, input: { householdId: string; userId: string }): Promise<void> {
  await db.insert(householdPeople).values(input)
}

/**
 * A member is leaving: their person stays, under the name they had, without the account. Their
 * passport still says whose it is, and the trips they went on still list them.
 */
export async function freezeMemberPerson(ctx: RequestContext, db: Db, userId: string): Promise<void> {
  const [row] = await db
    .select({ fullName: profiles.fullName, email: authUsers.email })
    .from(profiles)
    .leftJoin(authUsers, eq(authUsers.id, profiles.id))
    .where(eq(profiles.id, userId))
    .limit(1)
  const name = (row?.fullName?.trim() || row?.email?.split('@')[0]?.trim() || 'Former member').slice(0, 100)
  await db
    .update(householdPeople)
    .set({ userId: null, name })
    .where(and(eq(householdPeople.userId, userId), eq(householdPeople.householdId, ctx.householdId)))
}
