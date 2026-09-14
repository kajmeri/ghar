import type { CategoryColorToken, CategoryIcon, CategoryKind } from './types'

interface DefaultCategoryGroup {
  key: string
  name: string
  kind: CategoryKind
  icon: CategoryIcon
  children: readonly { key: string; name: string; icon: CategoryIcon }[]
}

// Two levels at most. Names are unique across the whole tree, because a household's category
// names are unique and a flat list of them is what the review queue and the model see.
const TREE = [
  {
    key: 'home',
    name: 'Home',
    kind: 'expense',
    icon: 'house',
    children: [
      { key: 'rent_mortgage', name: 'Rent and mortgage', icon: 'key-round' },
      { key: 'utilities', name: 'Utilities', icon: 'plug-zap' },
      { key: 'internet_phone', name: 'Internet and phone', icon: 'wifi' },
      { key: 'home_maintenance', name: 'Repairs and improvements', icon: 'hammer' },
      { key: 'furnishings', name: 'Furniture and decor', icon: 'sofa' },
    ],
  },
  {
    key: 'food',
    name: 'Food and drink',
    kind: 'expense',
    icon: 'utensils',
    children: [
      { key: 'groceries', name: 'Groceries', icon: 'shopping-cart' },
      { key: 'restaurants', name: 'Restaurants', icon: 'utensils-crossed' },
      { key: 'coffee', name: 'Coffee', icon: 'coffee' },
      { key: 'alcohol', name: 'Alcohol and bars', icon: 'wine' },
    ],
  },
  {
    key: 'transportation',
    name: 'Transportation',
    kind: 'expense',
    icon: 'car',
    children: [
      { key: 'fuel', name: 'Fuel', icon: 'fuel' },
      { key: 'public_transit', name: 'Public transit', icon: 'train-front' },
      { key: 'rideshare', name: 'Taxis and rideshare', icon: 'car-taxi-front' },
      { key: 'parking_tolls', name: 'Parking and tolls', icon: 'square-parking' },
      { key: 'car_payment', name: 'Car payment', icon: 'car-front' },
      { key: 'car_maintenance', name: 'Car maintenance', icon: 'wrench' },
    ],
  },
  {
    key: 'shopping',
    name: 'Shopping',
    kind: 'expense',
    icon: 'shopping-bag',
    children: [
      { key: 'everyday', name: 'Everyday shopping', icon: 'package' },
      { key: 'clothing', name: 'Clothing', icon: 'shirt' },
      { key: 'electronics', name: 'Electronics', icon: 'monitor-smartphone' },
      { key: 'hobbies', name: 'Hobbies and sports', icon: 'bike' },
      { key: 'gifts', name: 'Gifts', icon: 'gift' },
    ],
  },
  {
    key: 'health',
    name: 'Health and wellness',
    kind: 'expense',
    icon: 'heart-pulse',
    children: [
      { key: 'medical', name: 'Doctors and dentists', icon: 'stethoscope' },
      { key: 'pharmacy', name: 'Pharmacy', icon: 'pill' },
      { key: 'fitness', name: 'Fitness', icon: 'dumbbell' },
      { key: 'personal_care', name: 'Personal care', icon: 'scissors' },
    ],
  },
  {
    key: 'family',
    name: 'Family',
    kind: 'expense',
    icon: 'users',
    children: [
      { key: 'childcare', name: 'Childcare', icon: 'baby' },
      { key: 'education', name: 'Education', icon: 'graduation-cap' },
    ],
  },
  { key: 'pets', name: 'Pets', kind: 'expense', icon: 'paw-print', children: [] },
  {
    key: 'entertainment',
    name: 'Entertainment',
    kind: 'expense',
    icon: 'ticket',
    children: [
      { key: 'subscriptions', name: 'Streaming and subscriptions', icon: 'tv' },
      { key: 'events', name: 'Events and outings', icon: 'party-popper' },
      { key: 'games', name: 'Games', icon: 'gamepad-2' },
    ],
  },
  {
    key: 'travel',
    name: 'Travel',
    kind: 'expense',
    icon: 'plane',
    children: [
      { key: 'flights', name: 'Flights', icon: 'plane-takeoff' },
      { key: 'lodging', name: 'Lodging', icon: 'bed-double' },
      { key: 'rental_cars', name: 'Rental cars', icon: 'key' },
    ],
  },
  {
    key: 'bills',
    name: 'Bills and fees',
    kind: 'expense',
    icon: 'receipt',
    children: [
      { key: 'insurance', name: 'Insurance', icon: 'shield' },
      { key: 'taxes', name: 'Taxes', icon: 'landmark' },
      { key: 'loan_payments', name: 'Loan payments', icon: 'hand-coins' },
      { key: 'bank_fees', name: 'Bank fees', icon: 'banknote' },
      { key: 'services', name: 'Professional services', icon: 'briefcase' },
    ],
  },
  { key: 'giving', name: 'Giving', kind: 'expense', icon: 'hand-heart', children: [] },
  { key: 'other_expense', name: 'Other', kind: 'expense', icon: 'circle-ellipsis', children: [] },
  {
    key: 'income',
    name: 'Income',
    kind: 'income',
    icon: 'wallet',
    children: [
      { key: 'paychecks', name: 'Paychecks', icon: 'briefcase-business' },
      { key: 'interest_dividends', name: 'Interest and dividends', icon: 'percent' },
      { key: 'refunds', name: 'Refunds and reimbursements', icon: 'undo-2' },
      { key: 'other_income', name: 'Other income', icon: 'circle-plus' },
    ],
  },
  {
    key: 'transfers',
    name: 'Transfers',
    kind: 'transfer',
    icon: 'arrow-left-right',
    children: [
      { key: 'account_transfers', name: 'Between accounts', icon: 'arrow-left-right' },
      { key: 'credit_card_payments', name: 'Credit card payments', icon: 'credit-card' },
      { key: 'savings_investments', name: 'Savings and investing', icon: 'piggy-bank' },
      { key: 'cash', name: 'Cash and ATM', icon: 'banknote' },
    ],
  },
] as const satisfies readonly DefaultCategoryGroup[]

type Group = (typeof TREE)[number]

/** Ties a seeded category to Plaid's categories, so renaming it keeps the mapping. */
export type DefaultCategoryKey = Group['key'] | Group['children'][number]['key']

export interface DefaultCategory {
  key: DefaultCategoryKey
  name: string
  parentKey: DefaultCategoryKey | null
  kind: CategoryKind
  icon: CategoryIcon
  colorToken: CategoryColorToken
  /** Position among its siblings. */
  sortOrder: number
}

export function defaultColorToken(kind: CategoryKind): CategoryColorToken {
  return kind === 'income' ? 'positive' : 'ink-muted'
}

/** The tree every household starts with, parents before their children. */
export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = TREE.flatMap((group: Group, groupIndex): DefaultCategory[] => [
  {
    key: group.key,
    name: group.name,
    parentKey: null,
    kind: group.kind,
    icon: group.icon,
    colorToken: defaultColorToken(group.kind),
    sortOrder: groupIndex,
  },
  ...group.children.map((child: Group['children'][number], childIndex): DefaultCategory => ({
    key: child.key,
    name: child.name,
    parentKey: group.key,
    kind: group.kind,
    icon: child.icon,
    colorToken: defaultColorToken(group.kind),
    sortOrder: childIndex,
  })),
])
