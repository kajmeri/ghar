import { requirePermission } from '@ghar/core/auth'
import { NotFoundError } from '@ghar/core/errors'
import type { ManualAccountFields, ManualValueFields, ManualValueSource } from '@ghar/core/finances'
import { and, desc, eq, getTableColumns, isNull, sql, type SQL } from 'drizzle-orm'
import { manualAccounts, manualValues } from '../schema'
import { recordAudit } from './audit'
import { keysetAfter, keysetOrder, pageKeys, toPage, type Keyset, type Page, type PageRequest } from './pagination'
import type { Db, RequestContext } from './types'

// What the household owns or owes that no bank connection covers: the house, the cars, a 401k at an
// institution nobody linked. Values are a history. Updating an estimate adds a row, and the newest on
// or before a day is that day's value. Validation happens in @ghar/core/finances before these run.

export type ManualValueRow = typeof manualValues.$inferSelect

export type ManualAccountRow = typeof manualAccounts.$inferSelect & {
  /** The newest value, unsigned. All three are null before the first value. */
  latestValueOn: string | null
  latestValueCents: number | null
  latestValueSource: ManualValueSource | null
}

export type ManualAccountInput = ManualAccountFields & { isLiability: boolean }

const ACCOUNT_NOT_FOUND = 'That account no longer exists.'
const VALUE_NOT_FOUND = 'That value no longer exists.'

/**
 * The newest value's column, for the account in the outer query. Two on one day: the later entry.
 * The outer id names its table because Drizzle leaves a single-table select list unqualified, and a
 * bare "id" here would be the value's own.
 */
function latestValue(column: typeof manualValues.asOf | typeof manualValues.valueCents | typeof manualValues.source): SQL {
  return sql`(select ${column} from ${manualValues} where ${manualValues.manualAccountId} = ${manualAccounts}.${sql.identifier('id')} order by ${manualValues.asOf} desc, ${manualValues.createdAt} desc, ${manualValues.id} desc limit 1)`
}

/** An account with its newest value. Select from manual_accounts. */
export const manualAccountColumns = {
  ...getTableColumns(manualAccounts),
  latestValueOn: sql<string | null>`${latestValue(manualValues.asOf)}::text`,
  latestValueCents: sql<number | null>`${latestValue(manualValues.valueCents)}`.mapWith(Number),
  latestValueSource: sql<ManualValueSource | null>`${latestValue(manualValues.source)}`,
}

function accountKey(ctx: RequestContext, manualAccountId: string) {
  return and(eq(manualAccounts.id, manualAccountId), eq(manualAccounts.householdId, ctx.householdId))
}

const accountOrder: Keyset = { keys: [{ expr: sql`lower(${manualAccounts.name})`, kind: 'text' }], id: manualAccounts.id }

export interface ManualAccountListOptions {
  includeArchived: boolean
}

/** By name, ignoring case. For the net worth page, the snapshot job's household, and the reminders. */
export async function listManualAccounts(ctx: RequestContext, db: Db, options: ManualAccountListOptions): Promise<ManualAccountRow[]> {
  requirePermission(ctx, 'finances.view')
  return db
    .select(manualAccountColumns)
    .from(manualAccounts)
    .where(and(eq(manualAccounts.householdId, ctx.householdId), options.includeArchived ? undefined : isNull(manualAccounts.archivedAt)))
    .orderBy(...keysetOrder(accountOrder))
}

/** One page of listManualAccounts, in the same order. */
export async function listManualAccountsPage(
  ctx: RequestContext,
  db: Db,
  page: PageRequest,
  options: ManualAccountListOptions
): Promise<Page<ManualAccountRow>> {
  requirePermission(ctx, 'finances.view')
  const rows = await db
    .select({ ...manualAccountColumns, pageKeys: pageKeys(accountOrder) })
    .from(manualAccounts)
    .where(
      and(
        eq(manualAccounts.householdId, ctx.householdId),
        options.includeArchived ? undefined : isNull(manualAccounts.archivedAt),
        keysetAfter(accountOrder, page.after)
      )
    )
    .orderBy(...keysetOrder(accountOrder))
    .limit(page.limit + 1)
  return toPage(rows, page.limit)
}

export async function getManualAccount(ctx: RequestContext, db: Db, manualAccountId: string): Promise<ManualAccountRow> {
  requirePermission(ctx, 'finances.view')
  const [account] = await db.select(manualAccountColumns).from(manualAccounts).where(accountKey(ctx, manualAccountId)).limit(1)
  if (!account) throw new NotFoundError(ACCOUNT_NOT_FOUND)
  return account
}

/** With its first value, when there is one, in the same transaction. */
export async function createManualAccount(
  ctx: RequestContext,
  db: Db,
  input: ManualAccountInput,
  value: ManualValueFields | null
): Promise<ManualAccountRow> {
  requirePermission(ctx, 'finances.manage')
  return db.transaction(async tx => {
    const [created] = await tx
      .insert(manualAccounts)
      .values({ householdId: ctx.householdId, ...input })
      .returning({ id: manualAccounts.id })
    if (!created) throw new Error('The account was not created')
    if (value !== null) await tx.insert(manualValues).values({ manualAccountId: created.id, ...value })
    return getManualAccount(ctx, tx, created.id)
  })
}

/**
 * Replaces every field. Archiving keeps the first archived time. A new kind signs new snapshots its
 * way; the ones already taken keep what they recorded.
 */
export async function updateManualAccount(
  ctx: RequestContext,
  db: Db,
  manualAccountId: string,
  input: ManualAccountInput & { archived: boolean }
): Promise<ManualAccountRow> {
  requirePermission(ctx, 'finances.manage')
  const { archived, ...fields } = input
  return db.transaction(async tx => {
    const [updated] = await tx
      .update(manualAccounts)
      .set({
        ...fields,
        archivedAt: archived ? sql`coalesce(${manualAccounts.archivedAt}, now())` : null,
        updatedAt: sql`now()`,
      })
      .where(accountKey(ctx, manualAccountId))
      .returning({ id: manualAccounts.id })
    if (!updated) throw new NotFoundError(ACCOUNT_NOT_FOUND)
    return getManualAccount(ctx, tx, manualAccountId)
  })
}

/** Takes its values and snapshots with it, so past net worth days that counted it no longer add up. */
export async function deleteManualAccount(ctx: RequestContext, db: Db, manualAccountId: string): Promise<void> {
  requirePermission(ctx, 'finances.manage')
  await db.transaction(async tx => {
    const [deleted] = await tx
      .delete(manualAccounts)
      .where(accountKey(ctx, manualAccountId))
      .returning({ name: manualAccounts.name, kind: manualAccounts.kind })
    if (!deleted) throw new NotFoundError(ACCOUNT_NOT_FOUND)
    await recordAudit(ctx, tx, {
      action: 'manual_account.deleted',
      entity: 'manual_account',
      entityId: manualAccountId,
      metadata: { name: deleted.name, kind: deleted.kind },
    })
  })
}

// ---------------------------------------------------------------------------------------------
// Values

const valueOrder: Keyset = {
  keys: [
    { expr: manualValues.asOf, kind: 'date', desc: true },
    { expr: manualValues.createdAt, kind: 'timestamp', desc: true },
  ],
  id: manualValues.id,
  idDesc: true,
}

/** Throws NotFoundError unless the account is the household's. */
async function requireAccount(ctx: RequestContext, db: Db, manualAccountId: string): Promise<void> {
  const [account] = await db.select({ id: manualAccounts.id }).from(manualAccounts).where(accountKey(ctx, manualAccountId)).limit(1)
  if (!account) throw new NotFoundError(ACCOUNT_NOT_FOUND)
}

/** Newest first. */
export async function listManualValuesPage(ctx: RequestContext, db: Db, manualAccountId: string, page: PageRequest): Promise<Page<ManualValueRow>> {
  requirePermission(ctx, 'finances.view')
  await requireAccount(ctx, db, manualAccountId)
  const rows = await db
    .select({ ...getTableColumns(manualValues), pageKeys: pageKeys(valueOrder) })
    .from(manualValues)
    .where(and(eq(manualValues.manualAccountId, manualAccountId), keysetAfter(valueOrder, page.after)))
    .orderBy(...keysetOrder(valueOrder))
    .limit(page.limit + 1)
  return toPage(rows, page.limit)
}

/** Every value of the household's accounts, newest first within each. For the snapshot history. */
export async function listManualValues(ctx: RequestContext, db: Db, manualAccountId: string): Promise<ManualValueRow[]> {
  requirePermission(ctx, 'finances.view')
  await requireAccount(ctx, db, manualAccountId)
  return db
    .select()
    .from(manualValues)
    .where(eq(manualValues.manualAccountId, manualAccountId))
    .orderBy(desc(manualValues.asOf), desc(manualValues.createdAt), desc(manualValues.id))
}

export async function addManualValue(
  ctx: RequestContext,
  db: Db,
  manualAccountId: string,
  input: ManualValueFields
): Promise<{ value: ManualValueRow; account: ManualAccountRow }> {
  requirePermission(ctx, 'finances.manage')
  return db.transaction(async tx => {
    await requireAccount(ctx, tx, manualAccountId)
    const [value] = await tx
      .insert(manualValues)
      .values({ manualAccountId, ...input })
      .returning()
    if (!value) throw new Error('The value was not saved')
    return { value, account: await getManualAccount(ctx, tx, manualAccountId) }
  })
}

/** For a value entered by mistake. Snapshots already taken keep what they recorded. */
export async function deleteManualValue(ctx: RequestContext, db: Db, manualAccountId: string, valueId: string): Promise<ManualAccountRow> {
  requirePermission(ctx, 'finances.manage')
  return db.transaction(async tx => {
    await requireAccount(ctx, tx, manualAccountId)
    const [deleted] = await tx
      .delete(manualValues)
      .where(and(eq(manualValues.id, valueId), eq(manualValues.manualAccountId, manualAccountId)))
      .returning({ asOf: manualValues.asOf })
    if (!deleted) throw new NotFoundError(VALUE_NOT_FOUND)
    await recordAudit(ctx, tx, {
      action: 'manual_value.deleted',
      entity: 'manual_value',
      entityId: valueId,
      metadata: { manualAccountId, asOf: deleted.asOf },
    })
    return getManualAccount(ctx, tx, manualAccountId)
  })
}
