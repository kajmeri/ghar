import type { CategoryKindValue } from '@ghar/contracts'

/** What each kind of category is called on the screen: as a heading, and as one category. */
export const CATEGORY_KIND_LABELS: Record<CategoryKindValue, { many: string; one: string }> = {
  expense: { many: 'Spending', one: 'A spending category' },
  income: { many: 'Income', one: 'An income category' },
  transfer: { many: 'Transfers', one: 'A transfer category' },
}

/** The order the screen shows them in: what a household looks at most, first. */
export const CATEGORY_KINDS_IN_ORDER = ['expense', 'income', 'transfer'] as const satisfies readonly CategoryKindValue[]

/** The kind a select is on, kept a kind rather than a string. */
export function toCategoryKind(value: string): CategoryKindValue {
  return CATEGORY_KINDS_IN_ORDER.find(kind => kind === value) ?? 'expense'
}
