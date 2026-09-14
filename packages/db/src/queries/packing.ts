import { requirePermission } from '@ghar/core/auth'
import { NotFoundError, ValidationError } from '@ghar/core/errors'
import { draftsFromTemplate, templateDraftsFromItems } from '@ghar/core/packing'
import { and, eq, inArray, max, sql } from 'drizzle-orm'
import { packingItems, packingTemplateItems, packingTemplates } from '../schema'
import { recordAudit } from './audit'
import { requireHouseholdMembers, requireTrip } from './scope'
import type { Db, RequestContext } from './types'

// A trip's shared packing list, and the household's reusable templates.

export type PackingItemRow = typeof packingItems.$inferSelect
export type PackingTemplateRow = typeof packingTemplates.$inferSelect
export type PackingTemplateItemRow = typeof packingTemplateItems.$inferSelect

export interface PackingTemplateWithItems extends PackingTemplateRow {
  readonly items: PackingTemplateItemRow[]
}

const ITEM_NOT_FOUND = 'That packing item no longer exists.'
const TEMPLATE_NOT_FOUND = 'That packing template no longer exists.'

export async function listPackingItems(ctx: RequestContext, db: Db, tripId: string): Promise<PackingItemRow[]> {
  await requireTrip(ctx, db, tripId)
  return db.select().from(packingItems).where(eq(packingItems.tripId, tripId)).orderBy(packingItems.sortOrder, packingItems.label)
}

export async function createPackingItem(
  ctx: RequestContext,
  db: Db,
  tripId: string,
  input: { label: string; assignedUserId: string | null; category: string | null }
): Promise<PackingItemRow> {
  requirePermission(ctx, 'travel.manage')
  await requireTrip(ctx, db, tripId)
  if (input.assignedUserId) await requireHouseholdMembers(ctx, db, [input.assignedUserId])

  const [highest] = await db
    .select({ value: max(packingItems.sortOrder) })
    .from(packingItems)
    .where(eq(packingItems.tripId, tripId))

  const [item] = await db
    .insert(packingItems)
    .values({ tripId, ...input, sortOrder: (highest?.value ?? 0) + 1 })
    .returning()
  if (!item) throw new Error('The packing item was not created')
  return item
}

export async function updatePackingItem(
  ctx: RequestContext,
  db: Db,
  tripId: string,
  itemId: string,
  patch: Partial<{
    label: string
    assignedUserId: string | null
    isPacked: boolean
    category: string | null
  }>
): Promise<PackingItemRow> {
  requirePermission(ctx, 'travel.manage')
  await requireTrip(ctx, db, tripId)
  if (patch.assignedUserId) await requireHouseholdMembers(ctx, db, [patch.assignedUserId])

  const [item] = await db
    .update(packingItems)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(and(eq(packingItems.id, itemId), eq(packingItems.tripId, tripId)))
    .returning()
  if (!item) throw new NotFoundError(ITEM_NOT_FOUND)
  return item
}

export async function deletePackingItem(ctx: RequestContext, db: Db, tripId: string, itemId: string): Promise<void> {
  requirePermission(ctx, 'travel.manage')
  await requireTrip(ctx, db, tripId)
  const [deleted] = await db
    .delete(packingItems)
    .where(and(eq(packingItems.id, itemId), eq(packingItems.tripId, tripId)))
    .returning({ id: packingItems.id })
  if (!deleted) throw new NotFoundError(ITEM_NOT_FOUND)
}

export async function listPackingTemplates(ctx: RequestContext, db: Db): Promise<PackingTemplateWithItems[]> {
  requirePermission(ctx, 'travel.view')
  const templates = await db
    .select()
    .from(packingTemplates)
    .where(eq(packingTemplates.householdId, ctx.householdId))
    .orderBy(packingTemplates.name)
  if (templates.length === 0) return []

  const items = await db
    .select()
    .from(packingTemplateItems)
    .where(
      inArray(
        packingTemplateItems.templateId,
        templates.map(template => template.id)
      )
    )
    .orderBy(packingTemplateItems.sortOrder, packingTemplateItems.label)

  const byTemplate = new Map<string, PackingTemplateItemRow[]>()
  for (const item of items) {
    const existing = byTemplate.get(item.templateId)
    if (existing) existing.push(item)
    else byTemplate.set(item.templateId, [item])
  }
  return templates.map(template => ({
    ...template,
    items: byTemplate.get(template.id) ?? [],
  }))
}

export async function requireTemplate(ctx: RequestContext, db: Db, templateId: string): Promise<PackingTemplateWithItems> {
  requirePermission(ctx, 'travel.view')
  const [template] = await db
    .select()
    .from(packingTemplates)
    .where(and(eq(packingTemplates.id, templateId), eq(packingTemplates.householdId, ctx.householdId)))
    .limit(1)
  if (!template) throw new NotFoundError(TEMPLATE_NOT_FOUND)

  const items = await db
    .select()
    .from(packingTemplateItems)
    .where(eq(packingTemplateItems.templateId, templateId))
    .orderBy(packingTemplateItems.sortOrder, packingTemplateItems.label)
  return { ...template, items }
}

/**
 * Saves a reusable list. Given a trip, the trip's list becomes the template with packed
 * state and assignment dropped; given items, they are taken as written.
 */
export async function createPackingTemplate(
  ctx: RequestContext,
  db: Db,
  input: {
    name: string
    fromTripId?: string
    items?: readonly { label: string; category: string | null }[]
  }
): Promise<PackingTemplateWithItems> {
  requirePermission(ctx, 'travel.manage')
  const drafts = input.fromTripId
    ? templateDraftsFromItems(await listPackingItems(ctx, db, input.fromTripId))
    : (input.items ?? []).map((item, index) => ({ ...item, sortOrder: (index + 1) * 10 }))

  if (drafts.length === 0) {
    throw new ValidationError('A template needs at least one item.')
  }

  return db.transaction(async tx => {
    const [template] = await tx.insert(packingTemplates).values({ householdId: ctx.householdId, name: input.name }).returning()
    if (!template) throw new Error('The packing template was not created')

    const items = await tx
      .insert(packingTemplateItems)
      .values(drafts.map(draft => ({ templateId: template.id, ...draft })))
      .returning()
    await recordAudit(ctx, tx, {
      action: 'packing_template.created',
      entity: 'packing_template',
      entityId: template.id,
    })
    return { ...template, items }
  })
}

export async function deletePackingTemplate(ctx: RequestContext, db: Db, templateId: string): Promise<void> {
  requirePermission(ctx, 'travel.manage')
  await db.transaction(async tx => {
    const [deleted] = await tx
      .delete(packingTemplates)
      .where(and(eq(packingTemplates.id, templateId), eq(packingTemplates.householdId, ctx.householdId)))
      .returning({ id: packingTemplates.id, name: packingTemplates.name })
    if (!deleted) throw new NotFoundError(TEMPLATE_NOT_FOUND)
    await recordAudit(ctx, tx, {
      action: 'packing_template.deleted',
      entity: 'packing_template',
      entityId: templateId,
      metadata: { name: deleted.name },
    })
  })
}

/** Applying a template. Items the list already holds are skipped, so this is safe to repeat. */
export async function applyPackingTemplate(
  ctx: RequestContext,
  db: Db,
  tripId: string,
  templateId: string
): Promise<{ items: PackingItemRow[]; addedCount: number }> {
  requirePermission(ctx, 'travel.manage')
  const template = await requireTemplate(ctx, db, templateId)
  const existing = await listPackingItems(ctx, db, tripId)
  const drafts = draftsFromTemplate(template.items, existing)

  if (drafts.length > 0) {
    await db.insert(packingItems).values(drafts.map(draft => ({ tripId, ...draft, assignedUserId: null })))
  }
  return { items: await listPackingItems(ctx, db, tripId), addedCount: drafts.length }
}
