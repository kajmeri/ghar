import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import {
  calendarDateSchema,
  centsSchema,
  instantSchema,
  longTextSchema,
  pageQuerySchema,
  pageSchema,
  queryBooleanSchema,
  shortTextSchema,
} from './shared'

// Accounts and categories as a picker needs them: where a bill is paid from, and what a charge is
// filed under. Balances and anything from Plaid beyond the account's name stay out.

export const accountSchema = z.object({
  id: z.uuid(),
  /** The name with the last digits, as a picker shows it: "Checking ••1234". */
  label: z.string(),
  name: z.string(),
  mask: z.string().nullable(),
  institutionName: z.string().nullable(),
  /** Plaid's account type: depository, credit, loan, investment, other. */
  type: z.string(),
  subtype: z.string().nullable(),
})
export type Account = z.infer<typeof accountSchema>

export const categoryKindSchema = z.enum(['expense', 'income', 'transfer'])
export type CategoryKindValue = z.infer<typeof categoryKindSchema>

/** Mirrors CATEGORY_COLOR_TOKENS in @ghar/core/finances: token names from packages/tokens, never hex. */
export const categoryColorTokenSchema = z.enum(['ink', 'ink-muted', 'positive', 'caution', 'negative'])
export type CategoryColorTokenValue = z.infer<typeof categoryColorTokenSchema>

/** Mirrors CATEGORY_ICONS in @ghar/core/finances: the Lucide icons a category may wear. */
export const categoryIconSchema = z.enum([
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
])
export type CategoryIconValue = z.infer<typeof categoryIconSchema>

export const categorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** Set on a subcategory. Only a top-level category can be a parent. */
  parentId: z.uuid().nullable(),
  kind: categoryKindSchema,
  icon: categoryIconSchema,
  colorToken: categoryColorTokenSchema,
  /** The default category this was seeded as, which is how the bank's own categories find it. */
  systemKey: z.string().nullable(),
  /** Where it sits among its siblings. */
  sortOrder: z.int(),
  isArchived: z.boolean(),
})
export type Category = z.infer<typeof categorySchema>

/**
 * Owners and adults. The accounts the bill form offers: hidden ones are left out. By bank link,
 * oldest first, then by name.
 */
export const listAccounts = defineEndpoint({
  method: 'GET',
  path: '/api/v1/accounts',
  query: pageQuerySchema,
  response: pageSchema(accountSchema),
})

/**
 * Owners and adults. Archived categories are included, so a bill or charge filed under one still
 * shows its name; offer only the others for new choices. In the household's order, then by name.
 */
export const listCategories = defineEndpoint({
  method: 'GET',
  path: '/api/v1/categories',
  query: pageQuerySchema,
  response: pageSchema(categorySchema),
})

/** Mirrors CATEGORY_NAME_MAX_LENGTH in @ghar/core/finances. */
const categoryNameSchema = z.string().trim().min(1).max(40)

const categoryParamsSchema = z.object({ categoryId: z.uuid() })

/**
 * Owners and adults. A category of the household's own. Categories go two levels deep, and a
 * child is the same kind as its parent, so `parentId` must name a top-level category in use.
 * Names are the household's alone: two categories cannot share one, whatever the case.
 */
export const categoryBodySchema = z.object({
  name: categoryNameSchema,
  kind: categoryKindSchema,
  parentId: z.uuid().nullable().default(null),
  icon: categoryIconSchema,
  colorToken: categoryColorTokenSchema.default('ink-muted'),
})
export type CategoryBody = z.output<typeof categoryBodySchema>

export const createCategory = defineEndpoint({
  method: 'POST',
  path: '/api/v1/categories',
  body: categoryBodySchema,
  response: z.object({ category: categorySchema }),
})

export const categoryChangesSchema = z
  .object({
    name: categoryNameSchema.optional(),
    icon: categoryIconSchema.optional(),
    colorToken: categoryColorTokenSchema.optional(),
    sortOrder: z.int().min(0).max(1000).optional(),
  })
  .refine(body => Object.values(body).some(value => value !== undefined), {
    message: 'Change the name, the icon, the colour, or where it sits.',
  })
export type CategoryChanges = z.output<typeof categoryChangesSchema>

/**
 * Owners and adults. Renames or restyles a category, or moves it among its siblings. What it is
 * for and where it sits in the tree stay as they are: nothing already filed under it changes.
 * Leave out whatever you aren't changing.
 */
export const updateCategory = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/categories/:categoryId',
  params: categoryParamsSchema,
  body: categoryChangesSchema,
  response: z.object({ category: categorySchema }),
})

/**
 * Owners and adults. Archives a category or brings it back. Categories are never deleted: an
 * archived one keeps everything filed under it and every budget line it has had, and only drops
 * out of the pickers, the rules and what Ghar files by itself. Archiving a parent archives its
 * children with it; restoring brings back only the one named, and a child needs its parent back
 * first.
 */
export const setCategoryArchived = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/categories/:categoryId/archive',
  params: categoryParamsSchema,
  body: z.object({ isArchived: z.boolean() }),
  response: z.object({ category: categorySchema }),
})

// ---------------------------------------------------------------------------------------------
// Transactions

/** Mirrors CATEGORY_SOURCES in @ghar/core/finances: who decided the category. */
export const categorySourceSchema = z.enum(['user', 'rule', 'pfc', 'llm'])
export type CategorySourceValue = z.infer<typeof categorySourceSchema>

/**
 * One charge. The first six fields are the shape travel has always used, so a trip's budget panel
 * reads the same rows; the rest is what the money screen shows.
 *
 * A charge typed in by hand belongs to no account, which is why `accountId` and `accountLabel` are
 * nullable. Nothing here comes from Plaid beyond the merchant and the description.
 */
export const transactionSchema = z.object({
  id: z.uuid(),
  postedOn: calendarDateSchema,
  description: z.string(),
  merchant: z.string().nullable(),
  /** Negative is money out. `tripActualCents` in @ghar/core turns a list of these into spend. */
  amountCents: centsSchema,
  tripId: z.uuid().nullable(),
  accountId: z.uuid().nullable(),
  /** The account with its last digits, as the list shows it. Null on a charge typed in by hand. */
  accountLabel: z.string().nullable(),
  categoryId: z.uuid().nullable(),
  categoryName: z.string().nullable(),
  categorySource: categorySourceSchema.nullable(),
  /** The model's confidence as a whole percent, on a category it assigned or suggested. */
  categoryConfidence: z.int().nullable(),
  /** What the model thought but wasn't sure enough to file it under. */
  suggestedCategoryId: z.uuid().nullable(),
  needsReview: z.boolean(),
  isPending: z.boolean(),
  isTransfer: z.boolean(),
  /** Kept out of spending: a transfer between your own accounts, a reimbursement. */
  isExcluded: z.boolean(),
  notes: z.string().nullable(),
})
export type Transaction = z.infer<typeof transactionSchema>

/**
 * Owners and adults. Everyday spending, newest first, so a charge can be found, filed, or tagged
 * to a trip. Charges on a hidden account are left out unless that account is asked for by name.
 *
 * `categoryId` and `tripId` take `none` for "not filed" and "not on a trip". `review` narrows to
 * the queue: charges nothing has filed and nobody has excluded.
 */
export const listTransactions = defineEndpoint({
  method: 'GET',
  path: '/api/v1/transactions',
  query: pageQuerySchema.extend({
    tripId: z.union([z.uuid(), z.literal('none')]).optional(),
    /** Only what is not tagged to any trip yet. The same as `tripId=none`. */
    untagged: queryBooleanSchema.optional(),
    accountId: z.uuid().optional(),
    categoryId: z.union([z.uuid(), z.literal('none')]).optional(),
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
    /** Matches the description, the merchant or the notes. */
    q: z.string().trim().max(100).optional(),
    review: queryBooleanSchema.optional(),
  }),
  response: pageSchema(transactionSchema).extend({
    /** How many charges are waiting to be filed, whatever this page was filtered to. */
    reviewCount: z.int(),
  }),
})

/**
 * A charge typed in by hand: the cash dinner no card will ever tell you about, or a card that
 * isn't connected. It belongs to no account, which is how the rest of finances tells it from a
 * synced one.
 *
 * `amountCents` is negative for money out, as the column is. `tripId` tags it on the way in.
 */
export const createTransaction = defineEndpoint({
  method: 'POST',
  path: '/api/v1/transactions',
  body: z.object({
    postedOn: calendarDateSchema,
    description: shortTextSchema,
    merchant: shortTextSchema.nullable().default(null),
    amountCents: centsSchema.refine(value => value !== 0, 'An amount of nothing is not a charge'),
    tripId: z.uuid().nullable().default(null),
  }),
  response: z.object({ transaction: transactionSchema }),
})

/**
 * What a person owns on a charge: the category it is filed under, the trip it is tagged to,
 * whether it counts towards spending, and a note. A null `tripId` takes it back off a trip; a
 * `categoryId` files it, as the digest's one-tap link does, and must be one of the household's
 * unarchived categories. Leave out whatever you aren't changing.
 *
 * A category set here is a person's decision: it replaces whatever categorization decided, and
 * nothing automatic changes it again.
 */
export const tagTransaction = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/transactions/:transactionId',
  params: z.object({ transactionId: z.uuid() }),
  body: z
    .object({
      tripId: z.uuid().nullable().optional(),
      /** Null files it under nothing on purpose, which also takes it out of the review queue. */
      categoryId: z.uuid().nullable().optional(),
      isExcluded: z.boolean().optional(),
      notes: longTextSchema.nullable().optional(),
    })
    .refine(body => Object.values(body).some(value => value !== undefined), {
      message: 'Change the category, the trip, whether it counts, or the note.',
    }),
  response: z.object({ transaction: transactionSchema }),
})

// ---------------------------------------------------------------------------------------------
// The month so far: what the Money screen answers before anyone opens a list.

export const budgetPaceSchema = z.enum(['over_pace', 'on_pace', 'under_pace'])
export type BudgetPaceValue = z.infer<typeof budgetPaceSchema>

export const categorySpendSchema = z.object({
  /** A top-level category, or null for money out nobody has filed yet. */
  categoryId: z.uuid().nullable(),
  name: z.string(),
  spentCents: centsSchema,
  /** This category's part of everything spent this month, 0 to 1. */
  share: z.number().min(0).max(1),
})

export const moneyOverviewSchema = z.object({
  /** The household's today, and the month it falls in. */
  today: calendarDateSchema,
  monthStart: calendarDateSchema,
  /** Money out this month so far, refunds already taken off. */
  spentCents: centsSchema,
  /** Money in this month so far: what landed in an income category. */
  incomeCents: centsSchema,
  /** The same stretch of last month, which is what the change is measured against. */
  previousSpentCents: centsSchema,
  changeCents: centsSchema,
  /** The change as a share of last month, or null when last month had nothing to compare with. */
  changeShare: z.number().nullable(),
  categories: z.array(categorySpendSchema),
  /** Null until someone plans the month. Spending shows either way. */
  budget: z
    .object({
      periodStart: calendarDateSchema,
      availableCents: centsSchema,
      spentCents: centsSchema,
      remainingCents: centsSchema,
      pace: budgetPaceSchema,
      /** How much of the month has gone by, 0 to 1. */
      elapsedShare: z.number().min(0).max(1),
    })
    .nullable(),
  /** What's in the everyday accounts, and what the cards owe. Hidden accounts are left out. */
  cashCents: centsSchema,
  cardsCents: centsSchema,
  /** How many charges are waiting to be filed. */
  reviewCount: z.int(),
  /** The newest few charges, for the "recently" list. */
  recent: z.array(transactionSchema),
})
export type MoneyOverview = z.infer<typeof moneyOverviewSchema>

/**
 * Owners and adults. The month so far in one answer: spent against the same stretch of last
 * month, where it went, the budget if there is one, what's on hand, and the newest charges.
 */
export const getMoneyOverview = defineEndpoint({
  method: 'GET',
  path: '/api/v1/finances/overview',
  response: moneyOverviewSchema,
})

// ---------------------------------------------------------------------------------------------
// Budgets. A month is named by its first day, and every figure in it is cents.

/** Mirrors ProgressStatus in @ghar/core/progress: where a line stands against what it has. */
export const budgetStatusSchema = z.enum(['under', 'approaching', 'over'])
export type BudgetStatusValue = z.infer<typeof budgetStatusSchema>

/** A month whose budget is being read or planned: always the first of the month. */
export const monthStartSchema = calendarDateSchema.refine(value => value.endsWith('-01'), 'A budget month starts on the first day')

export const budgetLineSchema = z.object({
  id: z.uuid(),
  categoryId: z.uuid(),
  /** The category's name at the time of reading, so a client needs no second lookup. */
  categoryName: z.string(),
  plannedCents: centsSchema,
  rolloverEnabled: z.boolean(),
  /** What the month before left on this line, or its overspend as a negative. */
  rolloverInCents: centsSchema,
  availableCents: centsSchema,
  actualCents: centsSchema,
  remainingCents: centsSchema,
  status: budgetStatusSchema,
  pace: budgetPaceSchema,
})
export type BudgetLine = z.infer<typeof budgetLineSchema>

export const budgetMonthSchema = z.object({
  periodStart: calendarDateSchema,
  /** The household's today, which decides how much of the month has gone by. */
  today: calendarDateSchema,
  /** How much of the month has gone by, 0 to 1. A closed month reads 1. */
  elapsedShare: z.number().min(0).max(1),
  /** When the month was closed and its figures kept. Null while it is still open. */
  closedAt: instantSchema.nullable(),
  /** Whether the month is over and can be closed now. */
  canClose: z.boolean(),
  /** Whether the month before has lines to copy. */
  previousHasLines: z.boolean(),
  lines: z.array(budgetLineSchema),
  /** Spending in expense categories no line covers. */
  unbudgetedCents: centsSchema,
  /** Money out with no category yet. */
  uncategorizedCents: centsSchema,
  total: z.object({
    plannedCents: centsSchema,
    availableCents: centsSchema,
    /** Everything spent: the lines, the unbudgeted and the unfiled. */
    spentCents: centsSchema,
    remainingCents: centsSchema,
    status: budgetStatusSchema,
    pace: budgetPaceSchema,
  }),
})
export type BudgetMonth = z.infer<typeof budgetMonthSchema>

/**
 * Owners and adults. One month's plan against what it has spent. A month nobody has planned
 * answers with no lines and the spending it has anyway, so the screen can offer to plan it.
 */
export const getBudget = defineEndpoint({
  method: 'GET',
  path: '/api/v1/finances/budget',
  query: z.object({ periodStart: monthStartSchema.optional() }).prefault({}),
  response: budgetMonthSchema,
})

export const budgetLineBodySchema = z.object({
  periodStart: monthStartSchema,
  categoryId: z.uuid(),
  plannedCents: centsSchema.min(0).max(1_000_000_000),
  rolloverEnabled: z.boolean(),
})

/**
 * Owners and adults. Plans one category, or changes what it is planned. The month is created on
 * the first line, and a closed month refuses. A category may hold one line per month.
 */
export const setBudgetLine = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/finances/budget/lines',
  body: budgetLineBodySchema,
  response: z.object({ line: budgetLineSchema }),
})

/** Owners and adults. Takes a category out of the month's plan. Its spending stays where it is. */
export const deleteBudgetLine = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/finances/budget/lines/:lineId',
  params: z.object({ lineId: z.uuid() }),
  response: z.object({ lineId: z.uuid() }),
})

/**
 * Owners and adults. Brings the month before's lines across: its plans, its rollover settings,
 * and, once that month is closed, what each rollover line carried. Lines this month already has
 * are left alone.
 */
export const copyPreviousBudget = defineEndpoint({
  method: 'POST',
  path: '/api/v1/finances/budget/copy',
  body: z.object({ periodStart: monthStartSchema }),
  response: z.object({ copied: z.int() }),
})

/**
 * Owners and adults. Closes a month that has ended: each line keeps the actual it finished with,
 * so a bank correction months later can't rewrite it, and rollover lines hand what's left to the
 * month after. A month that isn't over yet refuses.
 */
export const closeBudgetMonth = defineEndpoint({
  method: 'POST',
  path: '/api/v1/finances/budget/close',
  body: z.object({ periodStart: monthStartSchema }),
  response: z.object({ budget: budgetMonthSchema }),
})

// ---------------------------------------------------------------------------------------------
// Goals. Something the household is saving towards, with an account standing for the progress.

/** Mirrors GOAL_NAME_MAX_LENGTH and GOAL_NOTES_MAX_LENGTH in @ghar/core/finances. */
const goalNameSchema = z.string().trim().min(1).max(80)
const goalNotesSchema = z.string().trim().max(500)

export const goalSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  targetCents: centsSchema,
  /** The day it should be reached by, when there is one. */
  targetDate: calendarDateSchema.nullable(),
  notes: z.string().nullable(),
  createdAt: instantSchema,
  /** The account whose balance stands for the progress. Null while nothing is linked. */
  linkedAccountId: z.uuid().nullable(),
  accountLabel: z.string().nullable(),
  /** Null when no account is linked, or the linked one is money owed rather than money held. */
  savedCents: centsSchema.nullable(),
  remainingCents: centsSchema.nullable(),
  fraction: z.number().min(0).max(1),
  reached: z.boolean(),
  /** Whole months to the target date, the month it falls in included. Null without a date. */
  monthsLeft: z.int().min(0).nullable(),
  /** What putting the rest aside evenly would take each month. */
  perMonthCents: centsSchema.nullable(),
  overdue: z.boolean(),
})
export type Goal = z.infer<typeof goalSchema>

export const goalBodySchema = z.object({
  name: goalNameSchema,
  targetCents: centsSchema.min(1).max(1_000_000_000),
  targetDate: calendarDateSchema.nullable().default(null),
  notes: goalNotesSchema.nullable().default(null),
  linkedAccountId: z.uuid().nullable().default(null),
})
export type GoalBody = z.output<typeof goalBodySchema>

const goalParamsSchema = z.object({ goalId: z.uuid() })

/** Owners and adults. Oldest first, with what each one's linked account has in it today. */
export const listGoals = defineEndpoint({
  method: 'GET',
  path: '/api/v1/finances/goals',
  response: z.object({
    goals: z.array(goalSchema),
    /** Every goal added up, so the screen can say where the household stands in one line. */
    totals: z.object({ targetCents: centsSchema, savedCents: centsSchema }),
  }),
})

export const createGoal = defineEndpoint({
  method: 'POST',
  path: '/api/v1/finances/goals',
  body: goalBodySchema,
  response: z.object({ goal: goalSchema }),
})

/** Owners and adults. Every field is given, so leaving one out clears it. */
export const updateGoal = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/finances/goals/:goalId',
  params: goalParamsSchema,
  body: goalBodySchema,
  response: z.object({ goal: goalSchema }),
})

/** Owners and adults. The linked account and its balance are untouched. */
export const deleteGoal = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/finances/goals/:goalId',
  params: goalParamsSchema,
  response: z.object({ goalId: z.uuid() }),
})

// ---------------------------------------------------------------------------------------------
// Rules. "Always file Trader Joe's as Groceries", in the household's own words.

/** Mirrors CATEGORY_MATCHER_TYPES in @ghar/core/finances: how a rule recognizes a charge. */
export const categoryMatcherTypeSchema = z.enum(['merchant_exact', 'merchant_contains', 'name_regex', 'amount_range'])
export type CategoryMatcherTypeValue = z.infer<typeof categoryMatcherTypeSchema>

/** Mirrors MATCHER_VALUE_MAX_LENGTH in @ghar/core/finances. */
const matcherValueSchema = z.string().trim().min(1).max(200)

export const categoryRuleSchema = z.object({
  id: z.uuid(),
  matcherType: categoryMatcherTypeSchema,
  /**
   * Stored as the server normalized it, which is what a rule compares against: a merchant
   * lowercased, a regular expression as typed, an amount range as "min..max" in signed cents.
   */
  matcherValue: z.string(),
  categoryId: z.uuid(),
  categoryName: z.string(),
  /** Higher runs first, after the exact merchant rules. */
  priority: z.int(),
  /** Charges this rule has filed since it was made. */
  hitCount: z.int(),
  createdByUserId: z.uuid().nullable(),
  createdAt: instantSchema,
})
export type CategoryRule = z.infer<typeof categoryRuleSchema>

/**
 * Owners and adults. Every rule, in the order they run: exact merchant matches first, then by
 * priority, then newest. A charge takes the category of the first rule that recognizes it.
 */
export const listCategoryRules = defineEndpoint({
  method: 'GET',
  path: '/api/v1/finances/rules',
  response: z.object({ rules: z.array(categoryRuleSchema) }),
})

/**
 * Owners and adults. Saves a rule and files the charges nobody has filed yet with it, so a rule
 * made today also tidies the past. Saving a matcher that already has a rule points that rule at
 * the new category. The category must be one of the household's, still in use.
 */
export const categoryRuleBodySchema = z.object({
  matcherType: categoryMatcherTypeSchema,
  matcherValue: matcherValueSchema,
  categoryId: z.uuid(),
  priority: z.int().min(0).max(1000).default(0),
})
export type CategoryRuleBody = z.output<typeof categoryRuleBodySchema>

export const saveCategoryRule = defineEndpoint({
  method: 'POST',
  path: '/api/v1/finances/rules',
  body: categoryRuleBodySchema,
  response: z.object({
    rule: categoryRuleSchema,
    /** Charges the rule filed on the spot. */
    applied: z.int(),
  }),
})

/** Owners and adults. Charges the rule already filed keep their category. */
export const deleteCategoryRule = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/finances/rules/:ruleId',
  params: z.object({ ruleId: z.uuid() }),
  response: z.object({ ruleId: z.uuid() }),
})

export const ruleSuggestionSchema = z.object({
  matcherType: z.literal('merchant_exact'),
  matcherValue: z.string(),
  categoryId: z.uuid(),
  categoryName: z.string(),
  /** The merchant as the charge names it: "Trader Joe's". */
  merchantLabel: z.string(),
  /** Charges nobody has filed that the rule would file now, this one not among them. */
  matchingCount: z.int(),
})
export type RuleSuggestion = z.infer<typeof ruleSuggestionSchema>

/**
 * Owners and adults. The rule worth offering after someone files a charge by hand, or null when
 * there is nothing to offer: nobody filed it, it has no merchant to match on, or a rule already
 * sends that merchant to that category. Ask after a successful file, and offer it once.
 */
export const getRuleSuggestion = defineEndpoint({
  method: 'GET',
  path: '/api/v1/transactions/:transactionId/rule-suggestion',
  params: z.object({ transactionId: z.uuid() }),
  response: z.object({ suggestion: ruleSuggestionSchema.nullable() }),
})
