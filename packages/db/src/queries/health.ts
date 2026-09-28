import { can, requirePermission } from '@ghar/core/auth'
import type { CalendarDate } from '@ghar/core/dates'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@ghar/core/errors'
import {
  canManageHealthOf,
  compareHealthDue,
  compareMedicines,
  healthEventTitle,
  healthScheduleDue,
  healthScheduleTitle,
  nextRefillBy,
  requireHealthCardFields,
  requireHealthEventDate,
  requireHealthScheduleFields,
  requireMedicineFields,
  type BloodType,
  type HealthDue,
  type HealthEventKind,
} from '@ghar/core/health'
import { HEALTH_SCAN_MAX_EVENTS } from '@ghar/core/health-scan'
import { and, asc, count, eq, getTableColumns, inArray, isNotNull, isNull, lte, max, or, sql, type SQL } from 'drizzle-orm'
import { authUsers } from 'drizzle-orm/supabase'
import {
  contacts,
  documents,
  healthCards,
  healthEvents,
  healthMedicines,
  healthRefillReminders,
  healthReminders,
  healthSchedules,
  householdMembers,
  householdPeople,
  profiles,
} from '../schema'
import { recordAudit } from './audit'
import { visibleDocumentSql } from './document-visibility'
import type { ReminderRecipient } from './expiry-reminders'
import { keysetAfter, keysetOrder, pageKeys, toPage, type Keyset, type Page, type PageRequest } from './pagination'
import { personRefColumns } from './people'
import { isUniqueViolation } from './pg-errors'
import type { Db, RequestContext, SystemContext } from './types'

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

/** The documents the caller may see, as the documents queries decide it. */
function visibleDocuments(ctx: RequestContext): SQL | undefined {
  return visibleDocumentSql(ctx)
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

async function requireLinksInHousehold(
  ctx: RequestContext,
  db: Db,
  input: Pick<HealthEventInput, 'contactId' | 'documentId'>
): Promise<void> {
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
/**
 * Several records for one person at once, all linked to the same document: what a scan found and
 * the person checked. Every one is checked before any is written, and they're written together,
 * so a bad date on one saves none. Returned in the order given.
 */
export async function createHealthEvents(
  ctx: RequestContext,
  db: Db,
  input: {
    personId: string
    documentId: string | null
    events: readonly Pick<HealthEventInput, 'kind' | 'title' | 'occurredOn'>[]
  },
  today: CalendarDate
): Promise<HealthEventRow[]> {
  requirePermission(ctx, 'health.view')
  if (input.events.length === 0) throw new ValidationError('Pick at least one record to save.')
  if (input.events.length > HEALTH_SCAN_MAX_EVENTS) {
    throw new ValidationError(`Save up to ${String(HEALTH_SCAN_MAX_EVENTS)} records at a time.`)
  }
  const values = input.events.map(event => {
    requireHealthEventDate(event.occurredOn, today)
    return {
      householdId: ctx.householdId,
      personId: input.personId,
      kind: event.kind,
      title: healthEventTitle(event.kind, event.title),
      occurredOn: event.occurredOn,
      contactId: null,
      documentId: input.documentId,
      note: null,
      addedBy: ctx.userId,
    }
  })
  await Promise.all([
    requireManageablePerson(ctx, db, input.personId),
    requireLinksInHousehold(ctx, db, { contactId: null, documentId: input.documentId }),
  ])
  const inserted = await db.insert(healthEvents).values(values).returning({ id: healthEvents.id })
  return Promise.all(inserted.map(event => getHealthEvent(ctx, db, event.id)))
}

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

// ---------------------------------------------------------------------------------------------
// What's due: schedules
// ---------------------------------------------------------------------------------------------

export type HealthScheduleRow = typeof healthSchedules.$inferSelect & {
  personName: string | null
  personUserId: string | null
} & HealthDue

export interface HealthScheduleInput {
  personId: string
  kind: HealthEventKind
  title: string | null
  cadenceMonths: number
  firstDueOn: CalendarDate
}

const SCHEDULE_NOT_FOUND = 'That schedule no longer exists.'
const SCHEDULE_TAKEN = 'They already have a schedule for that.'

/** What a schedule needs from a record to see whether it matches. */
const matchColumns = {
  personId: healthEvents.personId,
  kind: healthEvents.kind,
  title: healthEvents.title,
  occurredOn: healthEvents.occurredOn,
}

/** Schedules with whose they are and when each is next due, from the records beside them. */
async function loadSchedules(
  db: Db,
  where: SQL | undefined,
  eventsWhere: SQL | undefined,
  today: CalendarDate
): Promise<HealthScheduleRow[]> {
  const [schedules, events] = await Promise.all([
    db
      .select({ ...getTableColumns(healthSchedules), ...personRefColumns })
      .from(healthSchedules)
      .innerJoin(householdPeople, eq(householdPeople.id, healthSchedules.personId))
      .leftJoin(profiles, eq(profiles.id, householdPeople.userId))
      .where(where),
    db.select(matchColumns).from(healthEvents).innerJoin(householdPeople, eq(householdPeople.id, healthEvents.personId)).where(eventsWhere),
  ])
  return schedules
    .map(schedule => ({ ...schedule, ...healthScheduleDue(schedule, events, today) }))
    .toSorted((a, b) =>
      compareHealthDue({ dueOn: a.dueOn, title: healthScheduleTitle(a) }, { dueOn: b.dueOn, title: healthScheduleTitle(b) })
    )
}

/** The caller's visible schedules, soonest due first. Everyone's they may see, or one person's. */
export async function listHealthSchedules(
  ctx: RequestContext,
  db: Db,
  filter: { personId?: string },
  today: CalendarDate
): Promise<HealthScheduleRow[]> {
  requirePermission(ctx, 'health.view')
  const person = filter.personId === undefined ? undefined : filter.personId
  return loadSchedules(
    db,
    and(
      eq(healthSchedules.householdId, ctx.householdId),
      visibleHealth(ctx),
      person === undefined ? undefined : eq(healthSchedules.personId, person)
    ),
    and(
      eq(healthEvents.householdId, ctx.householdId),
      visibleHealth(ctx),
      person === undefined ? undefined : eq(healthEvents.personId, person)
    ),
    today
  )
}

export async function getHealthSchedule(ctx: RequestContext, db: Db, scheduleId: string, today: CalendarDate): Promise<HealthScheduleRow> {
  requirePermission(ctx, 'health.view')
  const [schedule] = await db
    .select({ personId: healthSchedules.personId })
    .from(healthSchedules)
    .innerJoin(householdPeople, eq(householdPeople.id, healthSchedules.personId))
    .where(and(eq(healthSchedules.id, scheduleId), eq(healthSchedules.householdId, ctx.householdId), visibleHealth(ctx)))
    .limit(1)
  if (!schedule) throw new NotFoundError(SCHEDULE_NOT_FOUND)
  const found = (await listHealthSchedules(ctx, db, { personId: schedule.personId }, today)).find(row => row.id === scheduleId)
  if (!found) throw new NotFoundError(SCHEDULE_NOT_FOUND)
  return found
}

async function requireManageableSchedule(ctx: RequestContext, db: Db, scheduleId: string, today: CalendarDate): Promise<HealthScheduleRow> {
  const schedule = await getHealthSchedule(ctx, db, scheduleId, today)
  if (!canManageHealthOf(ctx, schedule.personUserId)) throw new ForbiddenError("Your role in this household doesn't allow this.")
  return schedule
}

function takenAsValidation(error: unknown): never {
  if (isUniqueViolation(error, 'health_schedules_unique')) {
    throw new ValidationError(SCHEDULE_TAKEN, { details: { fieldErrors: { title: [SCHEDULE_TAKEN] } } })
  }
  throw error
}

export async function createHealthSchedule(
  ctx: RequestContext,
  db: Db,
  input: HealthScheduleInput,
  today: CalendarDate
): Promise<HealthScheduleRow> {
  requirePermission(ctx, 'health.view')
  const values = requireHealthScheduleFields(input)
  await requireManageablePerson(ctx, db, input.personId)
  const [created] = await db
    .insert(healthSchedules)
    .values({ householdId: ctx.householdId, ...values, addedBy: ctx.userId })
    .returning({ id: healthSchedules.id })
    .catch(takenAsValidation)
  if (!created) throw new Error('The health schedule was not created')
  return getHealthSchedule(ctx, db, created.id, today)
}

/** Replaces every field. Moving it to another person needs the right to log for both. */
export async function updateHealthSchedule(
  ctx: RequestContext,
  db: Db,
  scheduleId: string,
  input: HealthScheduleInput,
  today: CalendarDate
): Promise<HealthScheduleRow> {
  requirePermission(ctx, 'health.view')
  await requireManageableSchedule(ctx, db, scheduleId, today)
  const values = requireHealthScheduleFields(input)
  await requireManageablePerson(ctx, db, input.personId)
  const [updated] = await db
    .update(healthSchedules)
    .set({ ...values, updatedAt: sql`now()` })
    .where(and(eq(healthSchedules.id, scheduleId), eq(healthSchedules.householdId, ctx.householdId)))
    .returning({ id: healthSchedules.id })
    .catch(takenAsValidation)
  if (!updated) throw new NotFoundError(SCHEDULE_NOT_FOUND)
  return getHealthSchedule(ctx, db, scheduleId, today)
}

/** The records it counted stay. */
export async function deleteHealthSchedule(ctx: RequestContext, db: Db, scheduleId: string, today: CalendarDate): Promise<void> {
  requirePermission(ctx, 'health.view')
  await requireManageableSchedule(ctx, db, scheduleId, today)
  await db.transaction(async tx => {
    const [deleted] = await tx
      .delete(healthSchedules)
      .where(and(eq(healthSchedules.id, scheduleId), eq(healthSchedules.householdId, ctx.householdId)))
      .returning({ kind: healthSchedules.kind, personId: healthSchedules.personId })
    if (!deleted) throw new NotFoundError(SCHEDULE_NOT_FOUND)
    await recordAudit(ctx, tx, {
      action: 'health_schedule.deleted',
      entity: 'health_schedule',
      entityId: scheduleId,
      metadata: { kind: deleted.kind, personId: deleted.personId },
    })
  })
}

// ---------------------------------------------------------------------------------------------
// Reminder emails, for the daily job
// ---------------------------------------------------------------------------------------------

/** Every schedule in the household, with when it's due. Only the daily job reads everyone's this way. */
export async function listHealthSchedulesForReminders(actor: SystemContext, db: Db, today: CalendarDate): Promise<HealthScheduleRow[]> {
  return loadSchedules(db, eq(healthSchedules.householdId, actor.householdId), eq(healthEvents.householdId, actor.householdId), today)
}

/**
 * Claims one reminder tier for one due date. Null when that tier, or a closer one, already went
 * out for that date. Logging the visit moves the date, so the next round starts over.
 */
export async function claimHealthReminder(
  actor: SystemContext,
  db: Db,
  input: { scheduleId: string; dueOn: CalendarDate; thresholdDays: number }
): Promise<string | null> {
  const [closer] = await db
    .select({ id: healthReminders.id })
    .from(healthReminders)
    .where(
      and(
        eq(healthReminders.householdId, actor.householdId),
        eq(healthReminders.scheduleId, input.scheduleId),
        eq(healthReminders.dueOn, input.dueOn),
        lte(healthReminders.thresholdDays, input.thresholdDays)
      )
    )
    .limit(1)
  if (closer) return null
  const [claimed] = await db
    .insert(healthReminders)
    .values({ householdId: actor.householdId, ...input })
    .onConflictDoNothing()
    .returning({ id: healthReminders.id })
  return claimed?.id ?? null
}

export async function releaseHealthReminder(actor: SystemContext, db: Db, reminderId: string): Promise<void> {
  await db.delete(healthReminders).where(and(eq(healthReminders.id, reminderId), eq(healthReminders.householdId, actor.householdId)))
}

/**
 * Who hears about one person's schedule: owners and adults, who see everyone's records, and the
 * person themselves when they have an account. Never other members or viewers.
 */
export async function listHealthReminderRecipients(
  actor: SystemContext,
  db: Db,
  personUserId: string | null
): Promise<ReminderRecipient[]> {
  const rows = await db
    .select({ userId: householdMembers.userId, email: authUsers.email, fullName: profiles.fullName })
    .from(householdMembers)
    .innerJoin(profiles, eq(profiles.id, householdMembers.userId))
    .leftJoin(authUsers, eq(authUsers.id, householdMembers.userId))
    .where(
      and(
        eq(householdMembers.householdId, actor.householdId),
        personUserId === null
          ? inArray(householdMembers.role, ['owner', 'adult'])
          : or(inArray(householdMembers.role, ['owner', 'adult']), eq(householdMembers.userId, personUserId))
      )
    )
    .orderBy(householdMembers.joinedAt)
  return rows.flatMap(row => (row.email === null ? [] : [{ userId: row.userId, email: row.email, fullName: row.fullName }]))
}

// ---------------------------------------------------------------------------------------------
// Medicines
// ---------------------------------------------------------------------------------------------

export type HealthMedicineRow = typeof healthMedicines.$inferSelect & {
  personName: string | null
  personUserId: string | null
  /** Who prescribed it. */
  contactName: string | null
}

export interface HealthMedicineInput {
  personId: string
  name: string
  dose: string | null
  contactId: string | null
  startedOn: CalendarDate | null
  stoppedOn: CalendarDate | null
  refillBy: CalendarDate | null
  supplyDays: number | null
  note: string | null
}

const MEDICINE_NOT_FOUND = 'That medicine no longer exists.'

function selectHealthMedicines(db: Db) {
  return db
    .select({ ...getTableColumns(healthMedicines), ...personRefColumns, contactName: contacts.name })
    .from(healthMedicines)
    .innerJoin(householdPeople, eq(householdPeople.id, healthMedicines.personId))
    .leftJoin(profiles, eq(profiles.id, householdPeople.userId))
    .leftJoin(contacts, eq(contacts.id, healthMedicines.contactId))
}

/**
 * The medicines the caller may see: current ones by name, then stopped ones, most recently stopped
 * first. Everyone's, or one person's. With `current`, only the ones still being taken.
 */
export async function listHealthMedicines(
  ctx: RequestContext,
  db: Db,
  filter: { personId?: string; current?: boolean }
): Promise<HealthMedicineRow[]> {
  requirePermission(ctx, 'health.view')
  const rows = await selectHealthMedicines(db).where(
    and(
      eq(healthMedicines.householdId, ctx.householdId),
      visibleHealth(ctx),
      filter.personId === undefined ? undefined : eq(healthMedicines.personId, filter.personId),
      filter.current === true ? isNull(healthMedicines.stoppedOn) : undefined
    )
  )
  return rows.toSorted(compareMedicines)
}

export async function getHealthMedicine(ctx: RequestContext, db: Db, medicineId: string): Promise<HealthMedicineRow> {
  requirePermission(ctx, 'health.view')
  const [medicine] = await selectHealthMedicines(db)
    .where(and(eq(healthMedicines.id, medicineId), eq(healthMedicines.householdId, ctx.householdId), visibleHealth(ctx)))
    .limit(1)
  if (!medicine) throw new NotFoundError(MEDICINE_NOT_FOUND)
  return medicine
}

async function requireManageableMedicine(ctx: RequestContext, db: Db, medicineId: string): Promise<HealthMedicineRow> {
  const medicine = await getHealthMedicine(ctx, db, medicineId)
  if (!canManageHealthOf(ctx, medicine.personUserId)) throw new ForbiddenError("Your role in this household doesn't allow this.")
  return medicine
}

async function prepareMedicine(ctx: RequestContext, db: Db, input: HealthMedicineInput, today: CalendarDate) {
  const values = requireMedicineFields(input, today)
  await Promise.all([
    requireManageablePerson(ctx, db, input.personId),
    requireLinksInHousehold(ctx, db, { contactId: input.contactId, documentId: null }),
  ])
  return values
}

export async function createHealthMedicine(
  ctx: RequestContext,
  db: Db,
  input: HealthMedicineInput,
  today: CalendarDate
): Promise<HealthMedicineRow> {
  requirePermission(ctx, 'health.view')
  const values = await prepareMedicine(ctx, db, input, today)
  const [created] = await db
    .insert(healthMedicines)
    .values({ householdId: ctx.householdId, ...values, addedBy: ctx.userId })
    .returning({ id: healthMedicines.id })
  if (!created) throw new Error('The medicine was not created')
  return getHealthMedicine(ctx, db, created.id)
}

/** Replaces every field. Setting `stoppedOn` stops it, and clearing it starts it again. */
export async function updateHealthMedicine(
  ctx: RequestContext,
  db: Db,
  medicineId: string,
  input: HealthMedicineInput,
  today: CalendarDate
): Promise<HealthMedicineRow> {
  requirePermission(ctx, 'health.view')
  await requireManageableMedicine(ctx, db, medicineId)
  const values = await prepareMedicine(ctx, db, input, today)
  const [updated] = await db
    .update(healthMedicines)
    .set({ ...values, updatedAt: sql`now()` })
    .where(and(eq(healthMedicines.id, medicineId), eq(healthMedicines.householdId, ctx.householdId)))
    .returning({ id: healthMedicines.id })
  if (!updated) throw new NotFoundError(MEDICINE_NOT_FOUND)
  return getHealthMedicine(ctx, db, medicineId)
}

/** Stopped today. Its refill date goes, and the rest stays as history. */
export async function stopHealthMedicine(ctx: RequestContext, db: Db, medicineId: string, today: CalendarDate): Promise<HealthMedicineRow> {
  requirePermission(ctx, 'health.view')
  const medicine = await requireManageableMedicine(ctx, db, medicineId)
  if (medicine.stoppedOn !== null) return medicine
  // Started later than today (a date typed ahead) still stops today: the start moves back with it.
  const startedOn = medicine.startedOn !== null && medicine.startedOn > today ? today : medicine.startedOn
  await db
    .update(healthMedicines)
    .set({ stoppedOn: today, startedOn, refillBy: null, updatedAt: sql`now()` })
    .where(and(eq(healthMedicines.id, medicineId), eq(healthMedicines.householdId, ctx.householdId), isNull(healthMedicines.stoppedOn)))
  return getHealthMedicine(ctx, db, medicineId)
}

/**
 * Refilled on `refilledOn`, today unless it says: the next refill is one supply after it. Needs to
 * know how long a supply lasts, and can't go before the last refill.
 */
export async function refillHealthMedicine(
  ctx: RequestContext,
  db: Db,
  medicineId: string,
  today: CalendarDate,
  refilledOn: CalendarDate = today
): Promise<HealthMedicineRow> {
  requirePermission(ctx, 'health.view')
  const medicine = await requireManageableMedicine(ctx, db, medicineId)
  if (medicine.stoppedOn !== null) throw new ValidationError('They’ve stopped taking it. Start it again to track refills.')
  if (medicine.supplyDays === null) {
    const problem = 'Say how many days a refill lasts first.'
    throw new ValidationError(problem, { details: { fieldErrors: { supplyDays: [problem] } } })
  }
  if (refilledOn > today) {
    const problem = 'Pick a day that isn’t in the future.'
    throw new ValidationError(problem, { details: { fieldErrors: { refilledOn: [problem] } } })
  }
  if (medicine.lastRefilledOn !== null && refilledOn < medicine.lastRefilledOn) {
    const problem = 'It was refilled after that. Pick the day of the latest refill.'
    throw new ValidationError(problem, { details: { fieldErrors: { refilledOn: [problem] } } })
  }
  await db
    .update(healthMedicines)
    .set({ refillBy: nextRefillBy(refilledOn, medicine.supplyDays), lastRefilledOn: refilledOn, updatedAt: sql`now()` })
    .where(and(eq(healthMedicines.id, medicineId), eq(healthMedicines.householdId, ctx.householdId), isNull(healthMedicines.stoppedOn)))
  return getHealthMedicine(ctx, db, medicineId)
}

/**
 * Takes back the refill on `refilledOn`, putting the dates back as they were before it. Only while
 * it's still the latest refill and the medicine hasn't stopped, so a later change is never lost.
 */
export async function undoHealthMedicineRefill(
  ctx: RequestContext,
  db: Db,
  medicineId: string,
  input: { refilledOn: CalendarDate; previousRefillBy: CalendarDate | null; previousLastRefilledOn: CalendarDate | null }
): Promise<HealthMedicineRow> {
  requirePermission(ctx, 'health.view')
  await requireManageableMedicine(ctx, db, medicineId)
  if (input.previousLastRefilledOn !== null && input.previousLastRefilledOn >= input.refilledOn) {
    throw new ValidationError('The refill before it has to be earlier.')
  }
  const [undone] = await db
    .update(healthMedicines)
    .set({ refillBy: input.previousRefillBy, lastRefilledOn: input.previousLastRefilledOn, updatedAt: sql`now()` })
    .where(
      and(
        eq(healthMedicines.id, medicineId),
        eq(healthMedicines.householdId, ctx.householdId),
        eq(healthMedicines.lastRefilledOn, input.refilledOn),
        isNull(healthMedicines.stoppedOn)
      )
    )
    .returning({ id: healthMedicines.id })
  if (!undone) throw new ConflictError('It’s been refilled again or stopped since. Change it from its page.')
  return getHealthMedicine(ctx, db, medicineId)
}

/** For a mistake. Stopping it is how history is kept. */
export async function deleteHealthMedicine(ctx: RequestContext, db: Db, medicineId: string): Promise<void> {
  requirePermission(ctx, 'health.view')
  await requireManageableMedicine(ctx, db, medicineId)
  await db.transaction(async tx => {
    const [deleted] = await tx
      .delete(healthMedicines)
      .where(and(eq(healthMedicines.id, medicineId), eq(healthMedicines.householdId, ctx.householdId)))
      .returning({ personId: healthMedicines.personId })
    if (!deleted) throw new NotFoundError(MEDICINE_NOT_FOUND)
    // Whose it was, never its name: the audit log is for what changed, not what it said.
    await recordAudit(ctx, tx, {
      action: 'health_medicine.deleted',
      entity: 'health_medicine',
      entityId: medicineId,
      metadata: { personId: deleted.personId },
    })
  })
}

/** Current medicines with a refill date, across the household. Only the daily job reads everyone's this way. */
export async function listHealthRefillsForReminders(actor: SystemContext, db: Db): Promise<HealthMedicineRow[]> {
  return selectHealthMedicines(db).where(
    and(eq(healthMedicines.householdId, actor.householdId), isNull(healthMedicines.stoppedOn), isNotNull(healthMedicines.refillBy))
  )
}

/** Claims one refill reminder tier for one refill date. Null when it, or a closer one, already went out. */
export async function claimHealthRefillReminder(
  actor: SystemContext,
  db: Db,
  input: { medicineId: string; refillBy: CalendarDate; thresholdDays: number }
): Promise<string | null> {
  const [closer] = await db
    .select({ id: healthRefillReminders.id })
    .from(healthRefillReminders)
    .where(
      and(
        eq(healthRefillReminders.householdId, actor.householdId),
        eq(healthRefillReminders.medicineId, input.medicineId),
        eq(healthRefillReminders.refillBy, input.refillBy),
        lte(healthRefillReminders.thresholdDays, input.thresholdDays)
      )
    )
    .limit(1)
  if (closer) return null
  const [claimed] = await db
    .insert(healthRefillReminders)
    .values({ householdId: actor.householdId, ...input })
    .onConflictDoNothing()
    .returning({ id: healthRefillReminders.id })
  return claimed?.id ?? null
}

export async function releaseHealthRefillReminder(actor: SystemContext, db: Db, reminderId: string): Promise<void> {
  await db
    .delete(healthRefillReminders)
    .where(and(eq(healthRefillReminders.id, reminderId), eq(healthRefillReminders.householdId, actor.householdId)))
}

// ---------------------------------------------------------------------------------------------
// Health cards
// ---------------------------------------------------------------------------------------------

/** One person's card. Everyone the caller may see has one, blank until something goes on it. */
export interface HealthCardRow {
  personId: string
  personName: string | null
  personUserId: string | null
  bloodType: BloodType | null
  allergies: string[]
  conditions: string[]
  doctorContactId: string | null
  doctorName: string | null
  doctorPhone: string | null
  insuranceDocumentId: string | null
  /** Null when the document is gone, or the caller can't see it. */
  insuranceDocumentTitle: string | null
  emergencyNote: string | null
  /** Null until something has been saved. */
  updatedAt: Date | null
}

export interface HealthCardInput {
  bloodType: BloodType | null
  allergies: string[]
  conditions: string[]
  doctorContactId: string | null
  insuranceDocumentId: string | null
  emergencyNote: string | null
}

function selectHealthCards(ctx: RequestContext, db: Db) {
  return db
    .select({
      personId: householdPeople.id,
      ...personRefColumns,
      bloodType: healthCards.bloodType,
      allergies: healthCards.allergies,
      conditions: healthCards.conditions,
      doctorContactId: healthCards.doctorContactId,
      doctorName: contacts.name,
      doctorPhone: contacts.phone,
      insuranceDocumentId: healthCards.insuranceDocumentId,
      insuranceDocumentTitle: documents.title,
      emergencyNote: healthCards.emergencyNote,
      updatedAt: healthCards.updatedAt,
    })
    .from(householdPeople)
    .leftJoin(profiles, eq(profiles.id, householdPeople.userId))
    .leftJoin(healthCards, eq(healthCards.personId, householdPeople.id))
    .leftJoin(contacts, eq(contacts.id, healthCards.doctorContactId))
    .leftJoin(documents, and(eq(documents.id, healthCards.insuranceDocumentId), visibleDocuments(ctx)))
}

type SelectedCard = Awaited<ReturnType<ReturnType<typeof selectHealthCards>['where']>>[number]

function toCardRow(row: SelectedCard): HealthCardRow {
  return { ...row, allergies: row.allergies ?? [], conditions: row.conditions ?? [] }
}

/**
 * The cards of the people the caller may see, oldest person first. With `personIds`, only theirs:
 * anyone the caller can't see is left out rather than refused, as a trip's travellers may include them.
 */
export async function listHealthCards(ctx: RequestContext, db: Db, filter: { personIds?: readonly string[] }): Promise<HealthCardRow[]> {
  requirePermission(ctx, 'health.view')
  if (filter.personIds?.length === 0) return []
  const rows = await selectHealthCards(ctx, db)
    .where(
      and(
        eq(householdPeople.householdId, ctx.householdId),
        visibleHealth(ctx),
        filter.personIds === undefined ? undefined : inArray(householdPeople.id, [...filter.personIds])
      )
    )
    .orderBy(asc(householdPeople.createdAt), asc(householdPeople.id))
  return rows.map(toCardRow)
}

export async function getHealthCard(ctx: RequestContext, db: Db, personId: string): Promise<HealthCardRow> {
  requirePermission(ctx, 'health.view')
  const [row] = await selectHealthCards(ctx, db)
    .where(and(eq(householdPeople.id, personId), eq(householdPeople.householdId, ctx.householdId), visibleHealth(ctx)))
    .limit(1)
  if (!row) throw new NotFoundError(PERSON_NOT_FOUND)
  return toCardRow(row)
}

/** Replaces the whole card. Saving a blank one keeps the row, blank. */
export async function saveHealthCard(ctx: RequestContext, db: Db, personId: string, input: HealthCardInput): Promise<HealthCardRow> {
  requirePermission(ctx, 'health.view')
  const values = requireHealthCardFields(input)
  await requireManageablePerson(ctx, db, personId)
  // A document already on the card stays, even one the caller can't see: a member keeps the
  // insurance card an adult linked for them without being able to open it.
  const [saved] = await db
    .select({ insuranceDocumentId: healthCards.insuranceDocumentId })
    .from(healthCards)
    .where(and(eq(healthCards.personId, personId), eq(healthCards.householdId, ctx.householdId)))
    .limit(1)
  const keptDocument = values.insuranceDocumentId !== null && values.insuranceDocumentId === saved?.insuranceDocumentId
  await requireLinksInHousehold(ctx, db, {
    contactId: values.doctorContactId,
    documentId: keptDocument ? null : values.insuranceDocumentId,
  })
  const fields = {
    bloodType: values.bloodType,
    allergies: values.allergies,
    conditions: values.conditions,
    doctorContactId: values.doctorContactId,
    insuranceDocumentId: values.insuranceDocumentId,
    emergencyNote: values.emergencyNote,
    updatedBy: ctx.userId,
  }
  await db
    .insert(healthCards)
    .values({ personId, householdId: ctx.householdId, ...fields })
    .onConflictDoUpdate({ target: healthCards.personId, set: { ...fields, updatedAt: sql`now()` } })
  return getHealthCard(ctx, db, personId)
}
