import { ConflictError, ValidationError } from '../errors';
import {
  CATEGORY_COLOR_TOKENS,
  CATEGORY_ICONS,
  type CategoryColorToken,
  type CategoryIcon,
  type CategoryKind,
} from './types';

export const CATEGORY_NAME_MAX_LENGTH = 40;

function fieldError(field: string, message: string): ValidationError {
  return new ValidationError(message, { details: { fieldErrors: { [field]: [message] } } });
}

/** Trimmed, with single spaces. A household's names are unique regardless of case. */
export function normalizeCategoryName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (name === '') throw fieldError('name', 'Enter a name.');
  if (name.length > CATEGORY_NAME_MAX_LENGTH) {
    throw fieldError('name', `Keep it to ${CATEGORY_NAME_MAX_LENGTH} characters.`);
  }
  return name;
}

export function isCategoryIcon(value: string): value is CategoryIcon {
  return (CATEGORY_ICONS as readonly string[]).includes(value);
}

export function isCategoryColorToken(value: string): value is CategoryColorToken {
  return (CATEGORY_COLOR_TOKENS as readonly string[]).includes(value);
}

export interface CategoryNode {
  name: string;
  parentId: string | null;
  kind: CategoryKind;
  isArchived: boolean;
}

/** Categories go two levels deep, and a child is the same kind as its parent. */
export function assertCategoryParent(input: { kind: CategoryKind; parent: CategoryNode | null }) {
  const { parent } = input;
  if (parent === null) return;
  if (parent.parentId !== null) {
    throw fieldError('parentId', 'Choose a top-level category as the parent.');
  }
  if (parent.isArchived) {
    throw fieldError('parentId', `${parent.name} is archived. Restore it first.`);
  }
  if (parent.kind !== input.kind) {
    throw fieldError('parentId', `${parent.name} only holds ${parent.kind} categories.`);
  }
}

/** A child comes back only under a parent that is in use. */
export function assertCanRestoreCategory(parent: Pick<CategoryNode, 'name' | 'isArchived'> | null) {
  if (parent?.isArchived) throw new ConflictError(`Restore ${parent.name} first.`);
}

/** Budgets plan spending, so a line needs an expense category that is still in use. */
export function assertBudgetableCategory(category: Pick<CategoryNode, 'kind' | 'isArchived'>) {
  if (category.kind !== 'expense') {
    throw fieldError('categoryId', 'Budgets plan expense categories only.');
  }
  if (category.isArchived) {
    throw fieldError('categoryId', 'That category is archived. Restore it to plan for it.');
  }
}
