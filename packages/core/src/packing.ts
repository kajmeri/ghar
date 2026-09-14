import { ValidationError } from './errors';

/** The fields the list logic needs. Callers pass their own rows through. */
export interface PackingItemLike {
  readonly id: string;
  readonly label: string;
  readonly assignedUserId: string | null;
  readonly isPacked: boolean;
  readonly category: string | null;
  readonly sortOrder: number;
}

export interface PackingProgress {
  readonly packed: number;
  readonly total: number;
  readonly remaining: number;
  /** 0-1. An empty list is 0, not 1: nothing packed is not everything packed. */
  readonly ratio: number;
}

export function packingProgress(items: readonly PackingItemLike[]): PackingProgress {
  const total = items.length;
  const packed = items.reduce((count, item) => count + (item.isPacked ? 1 : 0), 0);
  return { packed, total, remaining: total - packed, ratio: total === 0 ? 0 : packed / total };
}

export interface PackingGroup<T> {
  /** A user id, a category name, or null for the unassigned and uncategorised group. */
  readonly key: string | null;
  readonly items: readonly T[];
  readonly progress: PackingProgress;
}

function compareItems(a: PackingItemLike, b: PackingItemLike): number {
  return a.sortOrder === b.sortOrder ? a.label.localeCompare(b.label) : a.sortOrder - b.sortOrder;
}

/** Groups in order of first appearance, with the null group last. */
function group<T extends PackingItemLike>(
  items: readonly T[],
  keyOf: (item: T) => string | null,
): PackingGroup<T>[] {
  const groups = new Map<string | null, T[]>();
  for (const item of [...items].sort(compareItems)) {
    const key = keyOf(item);
    const existing = groups.get(key);
    if (existing) existing.push(item);
    else groups.set(key, [item]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : 0))
    .map(([key, groupItems]) => ({ key, items: groupItems, progress: packingProgress(groupItems) }));
}

/** Who is carrying what. The null group is the household's to pick up. */
export function byAssignee<T extends PackingItemLike>(items: readonly T[]): PackingGroup<T>[] {
  return group(items, (item) => item.assignedUserId);
}

/** How the bags are organised. The null group is everything nobody filed. */
export function byCategory<T extends PackingItemLike>(items: readonly T[]): PackingGroup<T>[] {
  return group(items, (item) => item.category);
}

export interface PackingDraft {
  readonly label: string;
  readonly category: string | null;
  readonly sortOrder: number;
}

/** A label is the same item whether or not someone capitalised it. */
function dedupeKey(label: string, category: string | null): string {
  return `${(category ?? '').trim().toLowerCase()}::${label.trim().toLowerCase()}`;
}

/**
 * Applying a template to a list that already has things on it. Items the list already
 * holds are skipped rather than duplicated, and new ones go on the end so what is already
 * packed keeps its place. Assignment is deliberately not carried over: who packs what is
 * a decision per trip.
 */
export function draftsFromTemplate(
  templateItems: readonly { label: string; category: string | null; sortOrder: number }[],
  existing: readonly PackingItemLike[],
): PackingDraft[] {
  const seen = new Set(existing.map((item) => dedupeKey(item.label, item.category)));
  const highest = existing.reduce((max, item) => Math.max(max, item.sortOrder), 0);

  const drafts: PackingDraft[] = [];
  for (const item of [...templateItems].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const label = item.label.trim();
    if (label === '') continue;
    const key = dedupeKey(label, item.category);
    if (seen.has(key)) continue;
    seen.add(key);
    drafts.push({
      label,
      category: item.category?.trim() ?? null,
      sortOrder: highest + drafts.length + 1,
    });
  }
  return drafts;
}

/**
 * Saving a trip's list as a template. Packed state and assignment are dropped: a template
 * is the shape of a list, not a snapshot of one trip's progress through it.
 */
export function templateDraftsFromItems(items: readonly PackingItemLike[]): PackingDraft[] {
  const seen = new Set<string>();
  const drafts: PackingDraft[] = [];
  for (const item of [...items].sort(compareItems)) {
    const label = item.label.trim();
    if (label === '') continue;
    const key = dedupeKey(label, item.category);
    if (seen.has(key)) continue;
    seen.add(key);
    drafts.push({ label, category: item.category, sortOrder: (drafts.length + 1) * 10 });
  }
  if (drafts.length === 0) {
    throw new ValidationError('There is nothing on this list to save as a template');
  }
  return drafts;
}
