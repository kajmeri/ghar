import { can, requirePermission } from '@ghar/core/auth'
import type { CalendarDate } from '@ghar/core/dates'
import { NotFoundError, ValidationError } from '@ghar/core/errors'
import { initialNextDueOn, scheduleAfterCompletion, scheduleAfterRemoval, type AssetKind } from '@ghar/core/home'
import { and, asc, desc, eq, getTableColumns, gte, lte, sql } from 'drizzle-orm'
import { assets, contacts, documents, maintenance, maintenanceLog } from '../schema'
import { recordAudit } from './audit'
import { notRenewingSql } from './expiries'
import { keysetAfter, keysetOrder, pageKeys, toPage, type Keyset, type Page, type PageRequest } from './pagination'
import { requireHouseholdMembers } from './scope'
import type { Db, RequestContext } from './types'

// The things the household owns, the jobs that keep them running, and every time a job was done.

export type AssetRow = typeof assets.$inferSelect
export type MaintenanceRow = typeof maintenance.$inferSelect

export interface AssetInput {
  name: string
  kind: AssetKind
  make: string | null
  model: string | null
  serialNumber: string | null
  purchasedOn: CalendarDate | null
  purchasePriceCents: number | null
  warrantyExpiresOn: CalendarDate | null
  /** Days before the warranty ends that reminders start. Null, or left out on create, for the default. */
  warrantyRemindFromDays?: number | null
  location: string | null
  notes: string | null
}

const ASSET_NOT_FOUND = 'That asset no longer exists.'
const TASK_NOT_FOUND = 'That maintenance job no longer exists.'
const ENTRY_NOT_FOUND = 'That entry no longer exists.'

function assetKey(ctx: RequestContext, assetId: string) {
  return and(eq(assets.id, assetId), eq(assets.householdId, ctx.householdId))
}

function taskKey(ctx: RequestContext, taskId: string) {
  return and(eq(maintenance.id, taskId), eq(maintenance.householdId, ctx.householdId))
}

/** By name. */
export async function listAssets(ctx: RequestContext, db: Db): Promise<AssetRow[]> {
  requirePermission(ctx, 'home.view')
  return db
    .select()
    .from(assets)
    .where(eq(assets.householdId, ctx.householdId))
    .orderBy(sql`lower(${assets.name})`, asc(assets.id))
}

const assetOrder: Keyset = { keys: [{ expr: sql`lower(${assets.name})`, kind: 'text' }], id: assets.id }

/** One page of listAssets, in the same order. */
export async function listAssetsPage(ctx: RequestContext, db: Db, page: PageRequest): Promise<Page<AssetRow>> {
  requirePermission(ctx, 'home.view')
  const rows = await db
    .select({ ...getTableColumns(assets), pageKeys: pageKeys(assetOrder) })
    .from(assets)
    .where(and(eq(assets.householdId, ctx.householdId), keysetAfter(assetOrder, page.after)))
    .orderBy(...keysetOrder(assetOrder))
    .limit(page.limit + 1)
  return toPage(rows, page.limit)
}

export async function getAsset(ctx: RequestContext, db: Db, assetId: string): Promise<AssetRow> {
  requirePermission(ctx, 'home.view')
  const [asset] = await db.select().from(assets).where(assetKey(ctx, assetId)).limit(1)
  if (!asset) throw new NotFoundError(ASSET_NOT_FOUND)
  return asset
}

export async function createAsset(ctx: RequestContext, db: Db, input: AssetInput): Promise<AssetRow> {
  requirePermission(ctx, 'home.manage')
  const [asset] = await db
    .insert(assets)
    .values({ householdId: ctx.householdId, ...input })
    .returning()
  if (!asset) throw new Error('The asset was not created')
  return asset
}

export async function updateAsset(ctx: RequestContext, db: Db, assetId: string, input: AssetInput): Promise<AssetRow> {
  requirePermission(ctx, 'home.manage')
  const [asset] = await db
    .update(assets)
    .set({ ...input, updatedAt: sql`now()` })
    .where(assetKey(ctx, assetId))
    .returning()
  if (!asset) throw new NotFoundError(ASSET_NOT_FOUND)
  return asset
}

/** Takes the asset's jobs and their history with it. Its documents stay, unlinked. */
export async function deleteAsset(ctx: RequestContext, db: Db, assetId: string): Promise<void> {
  requirePermission(ctx, 'home.manage')
  await db.transaction(async tx => {
    const [deleted] = await tx.delete(assets).where(assetKey(ctx, assetId)).returning({ name: assets.name })
    if (!deleted) throw new NotFoundError(ASSET_NOT_FOUND)
    await recordAudit(ctx, tx, {
      action: 'asset.deleted',
      entity: 'asset',
      entityId: assetId,
      metadata: { name: deleted.name },
    })
  })
}

export interface WarrantyExpiryRow {
  id: string
  name: string
  warrantyExpiresOn: CalendarDate
  warrantyRemindFromDays: number | null
  /** Someone said it won't be renewed, for this date. */
  notRenewing: boolean
}

/** Assets whose warranty runs out from `from` through `to`, soonest first. */
export async function listWarrantyExpiries(
  ctx: RequestContext,
  db: Db,
  range: { from: CalendarDate; to: CalendarDate }
): Promise<WarrantyExpiryRow[]> {
  requirePermission(ctx, 'home.view')
  const rows = await db
    .select({
      id: assets.id,
      name: assets.name,
      warrantyExpiresOn: assets.warrantyExpiresOn,
      warrantyRemindFromDays: assets.warrantyRemindFromDays,
      notRenewing: notRenewingSql('warranty', assets.id, assets.warrantyExpiresOn),
    })
    .from(assets)
    .where(
      and(
        eq(assets.householdId, ctx.householdId),
        gte(assets.warrantyExpiresOn, range.from),
        lte(assets.warrantyExpiresOn, range.to)
      )
    )
    .orderBy(assets.warrantyExpiresOn, assets.name)
  return rows.flatMap(row => (row.warrantyExpiresOn === null ? [] : [{ ...row, warrantyExpiresOn: row.warrantyExpiresOn }]))
}

// Maintenance jobs

export interface MaintenanceVendor {
  id: string
  name: string
  role: string | null
  phone: string | null
}

export type MaintenanceTaskRow = MaintenanceRow & {
  assetName: string | null
  vendor: MaintenanceVendor | null
}

export interface MaintenanceInput {
  title: string
  assetId: string | null
  cadenceMonths: number | null
  cadenceMiles: number | null
  lastDoneOn: CalendarDate | null
  /** Null works it out from the cadence and lastDoneOn. */
  nextDueOn: CalendarDate | null
  assignedUserId: string | null
  instructions: string | null
  vendorContactId: string | null
}

const taskColumns = {
  ...getTableColumns(maintenance),
  assetName: assets.name,
  vendorId: contacts.id,
  vendorName: contacts.name,
  vendorRole: contacts.role,
  vendorPhone: contacts.phone,
}

type TaskSelectRow = MaintenanceRow & {
  assetName: string | null
  vendorId: string | null
  vendorName: string | null
  vendorRole: string | null
  vendorPhone: string | null
}

function toTask({ vendorId, vendorName, vendorRole, vendorPhone, ...task }: TaskSelectRow): MaintenanceTaskRow {
  const vendor = vendorId === null || vendorName === null ? null : { id: vendorId, name: vendorName, role: vendorRole, phone: vendorPhone }
  return { ...task, vendor }
}

function selectTasks(db: Db) {
  return db
    .select(taskColumns)
    .from(maintenance)
    .leftJoin(assets, eq(assets.id, maintenance.assetId))
    .leftJoin(contacts, eq(contacts.id, maintenance.vendorContactId))
}

/**
 * Soonest due first; jobs with no due date last. `dueFrom` and `dueTo` keep only jobs due in that
 * range (inclusive), which leaves out unscheduled ones.
 */
export async function listMaintenanceTasks(
  ctx: RequestContext,
  db: Db,
  filter: { assetId?: string; vendorContactId?: string; dueFrom?: CalendarDate; dueTo?: CalendarDate } = {}
): Promise<MaintenanceTaskRow[]> {
  requirePermission(ctx, 'home.view')
  const rows = await selectTasks(db)
    .where(
      and(
        eq(maintenance.householdId, ctx.householdId),
        filter.assetId === undefined ? undefined : eq(maintenance.assetId, filter.assetId),
        filter.vendorContactId === undefined ? undefined : eq(maintenance.vendorContactId, filter.vendorContactId),
        filter.dueFrom === undefined ? undefined : gte(maintenance.nextDueOn, filter.dueFrom),
        filter.dueTo === undefined ? undefined : lte(maintenance.nextDueOn, filter.dueTo)
      )
    )
    // Ascending puts nulls last in Postgres.
    .orderBy(asc(maintenance.nextDueOn), sql`lower(${maintenance.title})`, asc(maintenance.id))
  return rows.map(toTask)
}

const taskOrder: Keyset = {
  keys: [
    { expr: maintenance.nextDueOn, kind: 'date', nullable: true },
    { expr: sql`lower(${maintenance.title})`, kind: 'text' },
  ],
  id: maintenance.id,
}

/** One page of the household's jobs, in listMaintenanceTasks's order. */
export async function listMaintenanceTasksPage(ctx: RequestContext, db: Db, page: PageRequest): Promise<Page<MaintenanceTaskRow>> {
  requirePermission(ctx, 'home.view')
  const fetched = await db
    .select({ ...taskColumns, pageKeys: pageKeys(taskOrder) })
    .from(maintenance)
    .leftJoin(assets, eq(assets.id, maintenance.assetId))
    .leftJoin(contacts, eq(contacts.id, maintenance.vendorContactId))
    .where(and(eq(maintenance.householdId, ctx.householdId), keysetAfter(taskOrder, page.after)))
    .orderBy(...keysetOrder(taskOrder))
    .limit(page.limit + 1)
  const { rows, ...position } = toPage(fetched, page.limit)
  return { ...position, rows: rows.map(toTask) }
}

export async function getMaintenanceTask(ctx: RequestContext, db: Db, taskId: string): Promise<MaintenanceTaskRow> {
  requirePermission(ctx, 'home.view')
  const [row] = await selectTasks(db).where(taskKey(ctx, taskId)).limit(1)
  if (!row) throw new NotFoundError(TASK_NOT_FOUND)
  return toTask(row)
}

/** Ids from a request body are never trusted on their own: each has to be in the household. */
async function checkTaskLinks(ctx: RequestContext, db: Db, input: MaintenanceInput): Promise<void> {
  if (input.assetId !== null) {
    const [asset] = await db.select({ id: assets.id }).from(assets).where(assetKey(ctx, input.assetId)).limit(1)
    if (!asset) throw new ValidationError('That asset is not in the household.')
  }
  if (input.vendorContactId !== null) {
    const [contact] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.id, input.vendorContactId), eq(contacts.householdId, ctx.householdId)))
      .limit(1)
    if (!contact) throw new ValidationError('That contact is not in the household.')
  }
  if (input.assignedUserId !== null) await requireHouseholdMembers(ctx, db, [input.assignedUserId])
}

export async function createMaintenanceTask(ctx: RequestContext, db: Db, input: MaintenanceInput): Promise<MaintenanceTaskRow> {
  requirePermission(ctx, 'home.manage')
  await checkTaskLinks(ctx, db, input)
  const [task] = await db
    .insert(maintenance)
    .values({ householdId: ctx.householdId, ...input, nextDueOn: initialNextDueOn(input) })
    .returning({ id: maintenance.id })
  if (!task) throw new Error('The maintenance job was not created')
  return getMaintenanceTask(ctx, db, task.id)
}

/** Replaces every field. Leaving nextDueOn null works it out again from the cadence. */
export async function updateMaintenanceTask(
  ctx: RequestContext,
  db: Db,
  taskId: string,
  input: MaintenanceInput
): Promise<MaintenanceTaskRow> {
  requirePermission(ctx, 'home.manage')
  await checkTaskLinks(ctx, db, input)
  const [task] = await db
    .update(maintenance)
    .set({ ...input, nextDueOn: initialNextDueOn(input), updatedAt: sql`now()` })
    .where(taskKey(ctx, taskId))
    .returning({ id: maintenance.id })
  if (!task) throw new NotFoundError(TASK_NOT_FOUND)
  return getMaintenanceTask(ctx, db, taskId)
}

export async function deleteMaintenanceTask(ctx: RequestContext, db: Db, taskId: string): Promise<void> {
  requirePermission(ctx, 'home.manage')
  await db.transaction(async tx => {
    const [deleted] = await tx.delete(maintenance).where(taskKey(ctx, taskId)).returning({ title: maintenance.title })
    if (!deleted) throw new NotFoundError(TASK_NOT_FOUND)
    await recordAudit(ctx, tx, {
      action: 'maintenance.deleted',
      entity: 'maintenance',
      entityId: taskId,
      metadata: { title: deleted.title },
    })
  })
}

// Service history

export type MaintenanceLogEntryRow = typeof maintenanceLog.$inferSelect & { taskTitle: string }

export interface CompletionInput {
  completedOn: CalendarDate
  costCents: number | null
  notes: string | null
  documentId: string | null
  /** Today in the household's zone. A job can't be done in the future. */
  today: CalendarDate
}

/** A second tap on Mark done within this long, for the same day, is the same completion. */
const REPEAT_TAP_WINDOW = sql`interval '2 minutes'`

/**
 * Mark done: logs the work and rolls the schedule forward, in one transaction with the job locked
 * so two people tapping at once can't both roll it. A repeated tap (a flaky phone connection
 * retrying) returns the entry it already made instead of logging the job twice.
 */
export async function completeMaintenanceTask(
  ctx: RequestContext,
  db: Db,
  taskId: string,
  input: CompletionInput
): Promise<{ task: MaintenanceTaskRow; entry: MaintenanceLogEntryRow }> {
  requirePermission(ctx, 'home.manage')
  if (input.completedOn > input.today) throw new ValidationError("Pick the day it was done. It can't be later than today.")

  return db.transaction(async tx => {
    const [current] = await tx.select().from(maintenance).where(taskKey(ctx, taskId)).limit(1).for('update')
    if (!current) throw new NotFoundError(TASK_NOT_FOUND)

    const [repeat] = await tx
      .select()
      .from(maintenanceLog)
      .where(
        and(
          eq(maintenanceLog.maintenanceId, taskId),
          eq(maintenanceLog.completedOn, input.completedOn),
          ctx.userId === null ? undefined : eq(maintenanceLog.completedBy, ctx.userId),
          // A resend with a cost or note added is a correction, not a repeat.
          sql`${maintenanceLog.costCents} is not distinct from ${input.costCents}`,
          sql`${maintenanceLog.notes} is not distinct from ${input.notes}`,
          sql`${maintenanceLog.documentId} is not distinct from ${input.documentId}`,
          gte(maintenanceLog.createdAt, sql`now() - ${REPEAT_TAP_WINDOW}`)
        )
      )
      .limit(1)
    if (repeat) {
      return { task: await getMaintenanceTask(ctx, tx, taskId), entry: { ...repeat, taskTitle: current.title } }
    }

    if (input.documentId !== null) {
      const [document] = await tx
        .select({ isSensitive: documents.isSensitive })
        .from(documents)
        .where(and(eq(documents.id, input.documentId), eq(documents.householdId, ctx.householdId)))
        .limit(1)
      if (!document || (document.isSensitive && !can(ctx.role, 'documents.viewSensitive'))) {
        throw new ValidationError('That document is not in the household.')
      }
    }

    const [entry] = await tx
      .insert(maintenanceLog)
      .values({
        maintenanceId: taskId,
        completedOn: input.completedOn,
        completedBy: ctx.userId,
        costCents: input.costCents,
        notes: input.notes,
        documentId: input.documentId,
      })
      .returning()
    if (!entry) throw new Error('The completion was not logged')

    await tx
      .update(maintenance)
      .set({ ...scheduleAfterCompletion(current, input.completedOn), updatedAt: sql`now()` })
      .where(taskKey(ctx, taskId))

    return { task: await getMaintenanceTask(ctx, tx, taskId), entry: { ...entry, taskTitle: current.title } }
  })
}

/** Takes back an entry logged by mistake and works the schedule out again from what's left. */
export async function deleteMaintenanceCompletion(
  ctx: RequestContext,
  db: Db,
  taskId: string,
  entryId: string
): Promise<MaintenanceTaskRow> {
  requirePermission(ctx, 'home.manage')
  return db.transaction(async tx => {
    const [current] = await tx.select().from(maintenance).where(taskKey(ctx, taskId)).limit(1).for('update')
    if (!current) throw new NotFoundError(TASK_NOT_FOUND)

    const [removed] = await tx
      .delete(maintenanceLog)
      .where(and(eq(maintenanceLog.id, entryId), eq(maintenanceLog.maintenanceId, taskId)))
      .returning()
    if (!removed) throw new NotFoundError(ENTRY_NOT_FOUND)

    const [newest] = await tx
      .select({ completedOn: maintenanceLog.completedOn })
      .from(maintenanceLog)
      .where(eq(maintenanceLog.maintenanceId, taskId))
      .orderBy(desc(maintenanceLog.completedOn))
      .limit(1)

    await tx
      .update(maintenance)
      .set({ ...scheduleAfterRemoval(current, removed.completedOn, newest?.completedOn ?? null), updatedAt: sql`now()` })
      .where(taskKey(ctx, taskId))
    await recordAudit(ctx, tx, {
      action: 'maintenance.completion_deleted',
      entity: 'maintenance',
      entityId: taskId,
      metadata: { completedOn: removed.completedOn },
    })
    return getMaintenanceTask(ctx, tx, taskId)
  })
}

/**
 * Every time a job was done, newest first, for one job or every job on an asset. A receipt the
 * caller isn't allowed to see is left off its entry.
 */
export async function listMaintenanceHistory(
  ctx: RequestContext,
  db: Db,
  filter: { taskId: string } | { assetId: string }
): Promise<MaintenanceLogEntryRow[]> {
  requirePermission(ctx, 'home.view')
  const rows = await db
    .select({ ...getTableColumns(maintenanceLog), taskTitle: maintenance.title, documentIsSensitive: documents.isSensitive })
    .from(maintenanceLog)
    .innerJoin(maintenance, eq(maintenance.id, maintenanceLog.maintenanceId))
    .leftJoin(documents, eq(documents.id, maintenanceLog.documentId))
    .where(
      and(
        eq(maintenance.householdId, ctx.householdId),
        'taskId' in filter ? eq(maintenance.id, filter.taskId) : eq(maintenance.assetId, filter.assetId)
      )
    )
    .orderBy(desc(maintenanceLog.completedOn), desc(maintenanceLog.createdAt))

  const seesSensitive = can(ctx.role, 'documents.viewSensitive')
  return rows.map(({ documentIsSensitive, ...entry }) => ({
    ...entry,
    documentId: documentIsSensitive === true && !seesSensitive ? null : entry.documentId,
  }))
}
