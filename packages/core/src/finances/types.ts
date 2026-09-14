/** What a category is for. Spending totals and budgets count expense categories only. */
export const CATEGORY_KINDS = ['expense', 'income', 'transfer'] as const
export type CategoryKind = (typeof CATEGORY_KINDS)[number]

/** How a household rule recognizes a transaction. */
export const CATEGORY_MATCHER_TYPES = ['merchant_exact', 'merchant_contains', 'name_regex', 'amount_range'] as const
export type CategoryMatcherType = (typeof CATEGORY_MATCHER_TYPES)[number]

/**
 * Which layer set a transaction's category: a person, a household rule, Plaid's category, or the
 * language model. Nothing automatic ever overwrites a person's choice.
 */
export const CATEGORY_SOURCES = ['user', 'rule', 'pfc', 'llm'] as const
export type CategorySource = (typeof CATEGORY_SOURCES)[number]

/**
 * Token names from packages/tokens, never hex. Color carries meaning about money, so income is
 * positive and everything else stays muted unless a person picks otherwise.
 */
export const CATEGORY_COLOR_TOKENS = ['ink', 'ink-muted', 'positive', 'caution', 'negative'] as const
export type CategoryColorToken = (typeof CATEGORY_COLOR_TOKENS)[number]

/** Lucide icon names a category may use. The web app maps each to its component. */
export const CATEGORY_ICONS = [
  'arrow-left-right',
  'baby',
  'banknote',
  'bed-double',
  'bike',
  'briefcase',
  'briefcase-business',
  'car',
  'car-front',
  'car-taxi-front',
  'circle-ellipsis',
  'circle-plus',
  'coffee',
  'credit-card',
  'dumbbell',
  'fuel',
  'gamepad-2',
  'gift',
  'graduation-cap',
  'hammer',
  'hand-coins',
  'hand-heart',
  'heart-pulse',
  'house',
  'key',
  'key-round',
  'landmark',
  'monitor-smartphone',
  'package',
  'party-popper',
  'paw-print',
  'percent',
  'piggy-bank',
  'pill',
  'plane',
  'plane-takeoff',
  'plug-zap',
  'receipt',
  'scissors',
  'shield',
  'shirt',
  'shopping-bag',
  'shopping-cart',
  'sofa',
  'square-parking',
  'stethoscope',
  'tag',
  'ticket',
  'train-front',
  'tv',
  'undo-2',
  'users',
  'utensils',
  'utensils-crossed',
  'wallet',
  'wifi',
  'wine',
  'wrench',
] as const
export type CategoryIcon = (typeof CATEGORY_ICONS)[number]

export const BUDGET_PERIOD_TYPES = ['monthly'] as const
export type BudgetPeriodType = (typeof BUDGET_PERIOD_TYPES)[number]
