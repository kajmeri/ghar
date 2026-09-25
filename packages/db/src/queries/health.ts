import { can, requirePermission } from '@ghar/core/auth'
import type { CalendarDate } from '@ghar/core/dates'
import { ForbiddenError, NotFoundError, ValidationError } from '@ghar/core/errors'
import { canManageHealthOf, healthEventTitle, requireHealthEventDate, type HealthEventKind } from '@ghar/core/health'
import { and, asc, count, eq, getTableColumns, max, sql, type SQL } from 'drizzle-orm'
import { contacts, documents, healthEvents, householdPeople, profiles } from '../schema'
import { recordAudit } from './audit'
import { keysetAfter, keysetOrder, pageKeys, toPage, type Keyset, type Page, type PageRequest } from './pagination'
import { personRefColumns } from './people'
import type { Db, RequestContext } from './types'

// Health records. Owners and adults see and log everyone's; anyone else sees only the records of
// their own person, and members log their own. A record the caller can't see is reported as
// missing, never as forbidden, so its existence doesn't leak. Rules live in @ghar/core/health.

export type HealthEventRow = typeof healthEvents.$inferSelect & {
  /** Whose it is, by their own name or their profile's. */
  personName: string | null
  /** Their account, so "You" can be said. Null for someone without one. */
  personUserId: string | null
  contactName: string | null
  /** Null when the document is gone, or the caller can't see it. */
  documentTitle: string | null
}

export interface HealthEventInput {
  personId: string
  kind: HealthEventKind
  /** Blank or null for the kind's name. */
  title: string | null
  occurredOn: CalendarDate
  contactId: string | null
  documentId: string | null
  note: string | null
}

export interface HealthPersonRow {
  id: string
  userId: string | null
  name: string | null
  /** Whether the caller may log for them. */
  canManage: boolean
  eventCount: number
  /** When their latest record happened. Null when they have none. */
  lastOn: CalendarDate | null
}

const EVENT_NOT_FOUND = 'That health record no longer exists.'
const PERSON_NOT_FOUND = 'That person is no longer in the household.'

/** The records the caller may see. Needs household_people joined on the record's person. */
function visibleHealth(ctx: RequestContext): SQL | undefined {
  return can(ctx.role, 'health.everyone') ? undefined : eq(householdPeople.userId, ctx.userId)
}

/** The documents the caller's role may see, as the documents queries decide it. */
function visibleDocuments(ctx: RequestContext): SQL | undefined {
  return can(ctx.role, 'documents.viewSensitive') ? undefined : eq(documents.isSensitive, false)
}

/** A record with the names of whose it is and what it links to, plus any extra columns the caller asks for. */
function selectHealthEvents<Extra extends Record<string, SQL>>(ctx: RequestContext, db: Db, extra?: Extra) {
  return db
    .select({
      ...getTableColumns(healthEvents),
      ...personRefColumns,
      contactName: contacts.name,
      documentTitle: documents.title,
      ...(extra ?? ({} as Extra)),
    })
    .from(healthEvents)
    .innerJoin(householdPeople, eq(householdPeople.id, healthEvents.personId))
    .leftJoin(profiles, eq(profiles.id, householdPeople.userId))
    .leftJoin(contacts, eq(contacts.id, healthEvents.contactId))
    .leftJoin(documents, and(eq(documents.id, healthEvents.documentId), visibleDocuments(ctx)))
}

/** The people whose records the caller may see, oldest first, with how many they have. */
export async function listHealthPeople(ctx: RequestContext, db: Db): Promise<HealthPersonRow[]> {
  requirePermission(ctx, 'health.view')
  const rows = await db
    .select({
      id: householdPeople.id,
      userId: householdPeople.userId,
      name: personRefColumns.personName,
      eventCount: count(healthEvents.id),
      lastOn: max(healthEvents.occurredOn),
    })
    .from(householdPeople)
    .leftJoin(profiles, eq(profiles.id, householdPeople.userId))
    .leftJoin(healthEvents, eq(healthEvents.personId, householdPeople.id))
    .where(and(eq(householdPeople.householdId, ctx.householdId), visibleHealth(ctx)))
    .groupBy(householdPeople.id, profiles.fullName)
    .orderBy(asc(householdPeople.createdAt), asc(householdPeople.id))
  return rows.map(row => ({ ...row, canManage: canManageHealthOf(ctx, row.userId) }))
}

/**
 * The person a record is for, if the caller may log for them. Someone the caller can't see is
 * missing; someone they can see but not log for (a viewer's own person) is forbidden.
 */
async function requireManageablePerson(ctx: RequestContext, db: Db, personId: string): Promise<void> {
  const [person] = await db
    .select({ userId: householdPeople.userId })
    .from(householdPeople)
    .where(and(eq(householdPeople.id, personId), eq(householdPeople.householdId, ctx.householdId), visibleHealth(ctx)))
    .limit(1)
  if (!person) throw new NotFoundError(PERSON_NOT_FOUND)
  if (!canManageHealthOf(ctx, person.userId)) throw new ForbiddenError("Your role in this household doesn't allow this.")
}

async function requireLinksInHousehold(ctx: RequestContext, db: Db, input: HealthEventInput): Promise<void> {
  const checks: Promise<void>[] = []
  if (input.contactId !== null) {
    const contactId = input.contactId
    checks.push(
      db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.id, contactId), eq(contacts.householdId, ctx.householdId)))
        .limit(1)
        .then(([row]) => {
          if (!row) throw new ValidationError('That contact is not in the household.')
        })
    )
  }
  if (input.documentId !== null) {
    const documentId = input.documentId
    checks.push(
      db
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.id, documentId), eq(documents.householdId, ctx.householdId), visibleDocuments(ctx)))
        .limit(1)
        .then(([row]) => {
          if (!row) throw new ValidationError('That document is not in the household.')
        })
    )
  }
  await Promise.all(checks)
}

/** Checks and tidies what's about to be written. `today` is the household's. */
async function prepare(ctx: RequestContext, db: Db, input: HealthEventInput, today: CalendarDate) {
  requireHealthEventDate(input.occurredOn, today)
  const title = healthEventTitle(input.kind, input.title)
  const note = input.note?.trim() || null
  await Promise.all([requireManageablePerson(ctx, db, input.personId), requireLinksInHousehold(ctx, db, input)])
  return { ...input, title, note }
}

const eventOrder: Keyset = {
  keys: [
    { expr: healthEvents.occurredOn, kind: 'date', desc: true },
    { expr: healthEvents.createdAt, kind: 'timestamp', desc: true },
  ],
  id: healthEvents.id,
  idDesc: true,
}

/** Newest first. Everyone's the caller may see, or one person's. */
export async function listHealthEventsPage(
  ctx: RequestContext,
  db: Db,
  filter: { personId?: string },
  page: PageRequest
): Promise<Page<HealthEventRow>> {
  requirePermission(ctx, 'health.view')
  const rows = await selectHealthEvents(ctx, db, { pageKeys: pageKeys(eventOrder) })
    .where(
      and(
        eq(healthEvents.householdId, ctx.householdId),
        visibleHealth(ctx),
        filter.personId === undefined ? undefined : eq(healthEvents.personId, filter.personId),
        keysetAfter(eventOrder, page.after)
      )
    )
    .orderBy(...keysetOrder(eventOrder))
    .limit(page.limit + 1)
  return toPage(rows, page.limit)
}

export async function getHealthEvent(ctx: RequestContext, db: Db, eventId: string): Promise<HealthEventRow> {
  requirePermission(ctx, 'health.view')
  const [event] = await selectHealthEvents(ctx, db)
    .where(and(eq(healthEvents.id, eventId), eq(healthEvents.householdId, ctx.householdId), visibleHealth(ctx)))
    .limit(1)
  if (!event) throw new NotFoundError(EVENT_NOT_FOUND)
  return event
}

/** The record, if the caller may change it. Missing when they can't see it at all. */
async function requireManageableEvent(ctx: RequestContext, db: Db, eventId: string): Promise<HealthEventRow> {
  const event = await getHealthEvent(ctx, db, eventId)
  if (!canManageHealthOf(ctx, event.personUserId)) throw new ForbiddenError("Your role in this household doesn't allow this.")
  return event
}

export async function createHealthEvent(
  ctx: RequestContext,
  db: Db,
  input: HealthEventInput,
  today: CalendarDate
): Promise<HealthEventRow> {
  requirePermission(ctx, 'health.view')
  const values = await prepare(ctx, db, input, today)
  const [event] = await db
    .insert(healthEvents)
    .values({ householdId: ctx.householdId, ...values, addedBy: ctx.userId })
    .returning({ id: healthEvents.id })
  if (!event) throw new Error('The health record was not created')
  return getHealthEvent(ctx, db, event.id)
}

/** Replaces every field. Moving it to another person needs the right to log for both. */
export async function updateHealthEvent(
  ctx: RequestContext,
  db: Db,
  eventId: string,
  input: HealthEventInput,
  today: CalendarDate
): Promise<HealthEventRow> {
  requirePermission(ctx, 'health.view')
  await requireManageableEvent(ctx, db, eventId)
  const values = await prepare(ctx, db, input, today)
  return db.transaction(async tx => {
    const [updated] = await tx
      .update(healthEvents)
      .set({ ...values, updatedAt: sql`now()` })
      .where(and(eq(healthEvents.id, eventId), eq(healthEvents.householdId, ctx.householdId)))
      .returning({ id: healthEvents.id })
    if (!updated) throw new NotFoundError(EVENT_NOT_FOUND)
    return getHealthEvent(ctx, tx, eventId)
  })
}

/** The contact and document it pointed at stay. */
export async function deleteHealthEvent(ctx: RequestContext, db: Db, eventId: string): Promise<void> {
  requirePermission(ctx, 'health.view')
  await requireManageableEvent(ctx, db, eventId)
  await db.transaction(async tx => {
    const [deleted] = await tx
      .delete(healthEvents)
      .where(and(eq(healthEvents.id, eventId), eq(healthEvents.householdId, ctx.householdId)))
      .returning({ kind: healthEvents.kind, personId: healthEvents.personId })
    if (!deleted) throw new NotFoundError(EVENT_NOT_FOUND)
    // The kind and whose it was, never the title or note: the audit log is for what changed, not what it said.
    await recordAudit(ctx, tx, {
      action: 'health_event.deleted',
      entity: 'health_event',
      entityId: eventId,
      metadata: { kind: deleted.kind, personId: deleted.personId },
    })
  })
}
