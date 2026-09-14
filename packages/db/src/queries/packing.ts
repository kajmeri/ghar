import 'server-only';
import type { RequestContext } from '@casa/contracts';
import { NotFoundError } from '@casa/core/errors';
import { draftsFromTemplate, templateDraftsFromItems } from '@casa/core/packing';
import { and, eq, inArray, max } from 'drizzle-orm';
import type { Database } from '../index';
import { packingItems, packingTemplateItems, packingTemplates } from '../schema';
import { requireTrip } from './scope';

export type PackingItemRow = typeof packingItems.$inferSelect;
export type PackingTemplateRow = typeof packingTemplates.$inferSelect;
export type PackingTemplateItemRow = typeof packingTemplateItems.$inferSelect;

export interface PackingTemplateWithItems extends PackingTemplateRow {
  readonly items: PackingTemplateItemRow[];
}

export async function listPackingItems(
  db: Database,
  ctx: RequestContext,
  tripId: string,
): Promise<PackingItemRow[]> {
  await requireTrip(db, ctx, tripId);
  return db
    .select()
    .from(packingItems)
    .where(eq(packingItems.tripId, tripId))
    .orderBy(packingItems.sortOrder, packingItems.label);
}

export async function createPackingItem(
  db: Database,
  ctx: RequestContext,
  tripId: string,
  input: { label: string; assignedUserId: string | null; category: string | null },
): Promise<PackingItemRow> {
  await requireTrip(db, ctx, tripId);
  const [highest] = await db
    .select({ value: max(packingItems.sortOrder) })
    .from(packingItems)
    .where(eq(packingItems.tripId, tripId));

  const [item] = await db
    .insert(packingItems)
    .values({ tripId, ...input, sortOrder: (highest?.value ?? 0) + 1 })
    .returning();
  if (!item) throw new Error('The packing item was not created');
  return item;
}

export async function updatePackingItem(
  db: Database,
  ctx: RequestContext,
  tripId: string,
  itemId: string,
  patch: Partial<{
    label: string;
    assignedUserId: string | null;
    isPacked: boolean;
    category: string | null;
  }>,
): Promise<PackingItemRow> {
  await requireTrip(db, ctx, tripId);
  const [item] = await db
    .update(packingItems)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(packingItems.id, itemId), eq(packingItems.tripId, tripId)))
    .returning();
  if (!item) throw new NotFoundError('That packing item does not exist');
  return item;
}

export async function deletePackingItem(
  db: Database,
  ctx: RequestContext,
  tripId: string,
  itemId: string,
): Promise<void> {
  await requireTrip(db, ctx, tripId);
  const [deleted] = await db
    .delete(packingItems)
    .where(and(eq(packingItems.id, itemId), eq(packingItems.tripId, tripId)))
    .returning({ id: packingItems.id });
  if (!deleted) throw new NotFoundError('That packing item does not exist');
}

export async function listPackingTemplates(
  db: Database,
  ctx: RequestContext,
): Promise<PackingTemplateWithItems[]> {
  const templates = await db
    .select()
    .from(packingTemplates)
    .where(eq(packingTemplates.householdId, ctx.householdId))
    .orderBy(packingTemplates.name);
  if (templates.length === 0) return [];

  const items = await db
    .select()
    .from(packingTemplateItems)
    .where(
      inArray(
        packingTemplateItems.templateId,
        templates.map((template) => template.id),
      ),
    )
    .orderBy(packingTemplateItems.sortOrder, packingTemplateItems.label);

  const byTemplate = new Map<string, PackingTemplateItemRow[]>();
  for (const item of items) {
    const existing = byTemplate.get(item.templateId);
    if (existing) existing.push(item);
    else byTemplate.set(item.templateId, [item]);
  }
  return templates.map((template) => ({
    ...template,
    items: byTemplate.get(template.id) ?? [],
  }));
}

export async function requireTemplate(
  db: Database,
  ctx: RequestContext,
  templateId: string,
): Promise<PackingTemplateWithItems> {
  const [template] = await db
    .select()
    .from(packingTemplates)
    .where(
      and(eq(packingTemplates.id, templateId), eq(packingTemplates.householdId, ctx.householdId)),
    )
    .limit(1);
  if (!template) throw new NotFoundError('That packing template does not exist');

  const items = await db
    .select()
    .from(packingTemplateItems)
    .where(eq(packingTemplateItems.templateId, templateId))
    .orderBy(packingTemplateItems.sortOrder, packingTemplateItems.label);
  return { ...template, items };
}

/**
 * Saves a reusable list. Given a trip, the trip's list becomes the template with packed
 * state and assignment dropped; given items, they are taken as written.
 */
export async function createPackingTemplate(
  db: Database,
  ctx: RequestContext,
  input: {
    name: string;
    fromTripId?: string;
    items?: readonly { label: string; category: string | null }[];
  },
): Promise<PackingTemplateWithItems> {
  const drafts = input.fromTripId
    ? templateDraftsFromItems(await listPackingItems(db, ctx, input.fromTripId))
    : (input.items ?? []).map((item, index) => ({ ...item, sortOrder: (index + 1) * 10 }));

  if (drafts.length === 0) {
    throw new NotFoundError('A template needs at least one item');
  }

  return db.transaction(async (tx) => {
    const [template] = await tx
      .insert(packingTemplates)
      .values({ householdId: ctx.householdId, name: input.name })
      .returning();
    if (!template) throw new Error('The packing template was not created');

    const items = await tx
      .insert(packingTemplateItems)
      .values(drafts.map((draft) => ({ templateId: template.id, ...draft })))
      .returning();
    return { ...template, items };
  });
}

export async function deletePackingTemplate(
  db: Database,
  ctx: RequestContext,
  templateId: string,
): Promise<void> {
  const [deleted] = await db
    .delete(packingTemplates)
    .where(
      and(eq(packingTemplates.id, templateId), eq(packingTemplates.householdId, ctx.householdId)),
    )
    .returning({ id: packingTemplates.id });
  if (!deleted) throw new NotFoundError('That packing template does not exist');
}

/** Applying a template. Items the list already holds are skipped, so this is safe to repeat. */
export async function applyPackingTemplate(
  db: Database,
  ctx: RequestContext,
  tripId: string,
  templateId: string,
): Promise<{ items: PackingItemRow[]; addedCount: number }> {
  await requireTrip(db, ctx, tripId);
  const template = await requireTemplate(db, ctx, templateId);
  const existing = await listPackingItems(db, ctx, tripId);
  const drafts = draftsFromTemplate(template.items, existing);

  if (drafts.length > 0) {
    await db
      .insert(packingItems)
      .values(drafts.map((draft) => ({ tripId, ...draft, assignedUserId: null })));
  }
  return { items: await listPackingItems(db, ctx, tripId), addedCount: drafts.length };
}
