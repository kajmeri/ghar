import { requirePermission } from '@ghar/core/auth'
import type { CalendarDate } from '@ghar/core/dates'
import { ConflictError, NotFoundError, ValidationError } from '@ghar/core/errors'
import {
  addMonths,
  assertBudgetableCategory,
  assertCanCloseBudget,
  assertCanRestoreCategory,
  assertCategoryParent,
  assertMonthStart,
  assertPlannedCents,
  closeBudget,
  compileRules,
  copyBudgetLines,
  DEFAULT_CATEGORIES,
  elapsedShare,
  firstMatchingRule,
  merchantKey,
  merchantLabel,
  normalizeCategoryName,
  normalizeMatcherValue,
  periodEnd,
  suggestedRuleMatcher,
  summarizeBudget,
  validateGoal,
  type BudgetLineInput,
  type BudgetSummary,
  type CategorizableTransaction,
  type CategorizationCategory,
  type CategorizationState,
  type CategoryColorToken,
  type CategoryIcon,
  type CategoryKind,
  type CategoryMatcherType,
  type CategoryRuleInput,
  type CategorySpend,
  type DefaultCategory,
  type DeterministicAssignment,
  type GoalFields,
  type LlmOutcome,
  type MonthlyCategorySpend,
} from '@ghar/core/finances'
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, max, or, sql } from 'drizzle-orm'
import { accounts, budgetLines, budgets, categories, categoryRules, goals, households, transactions } from '../schema'
import { recordAudit } from './audit'
import { authorize } from './authorize'
import { keysetAfter, keysetOrder, pageKeys, toPage, type Keyset, type Page, type PageRequest } from './pagination'
import { isUniqueViolation } from './pg-errors'
import type { Actor, Db, RequestContext } from './types'

// Categories, categorization rules, budgets, goals and the spending aggregates behind insights.
// People reach these with a RequestContext. The categorization run that follows a sync has no
// person, so its functions take an Actor, like the sync itself.

function fieldError(field: string, message: string): ValidationError {
  return new ValidationError(message, { details: { fieldErrors: { [field]: [message] } } })
}

// ---------------------------------------------------------------------------------------------
// Categories

export interface CategoryRow {
  id: string
  name: string
  parentId: string | null
  kind: CategoryKind
  icon: CategoryIcon
  colorToken: CategoryColorToken
  systemKey: string | null
  sortOrder: number
  isArchived: boolean
}

const categoryColumns = {
  id: categories.id,
  name: categories.name,
  parentId: categories.parentId,
  kind: categories.kind,
  icon: categories.icon,
  colorToken: categories.colorToken,
  systemKey: categories.systemKey,
  sortOrder: categories.sortOrder,
  isArchived: categories.isArchived,
}

const CATEGORY_NOT_FOUND = 'That category no longer exists.'

function categoryKey(ctx: RequestContext, categoryId: string) {
  return and(eq(categories.id, categoryId), eq(categories.householdId, ctx.householdId))
}

/** Every category, archived ones included, so old transactions can still name theirs. */
export async function listCategories(ctx: RequestContext, db: Db): Promise<CategoryRow[]> {
  requirePermission(ctx, 'finances.view')
  return db
    .select(categoryColumns)
    .from(categories)
    .where(eq(categories.householdId, ctx.householdId))
    .orderBy(asc(categories.sortOrder), asc(categories.name), asc(categories.id))
}

const categoryOrder: Keyset = {
  keys: [
    { expr: categories.sortOrder, kind: 'integer' },
    { expr: categories.name, kind: 'text' },
  ],
  id: categories.id,
}

/** One page of listCategories, archived ones included, in the same order. */
export async function listCategoriesPage(ctx: RequestContext, db: Db, page: PageRequest): Promise<Page<CategoryRow>> {
  requirePermission(ctx, 'finances.view')
  const rows = await db
    .select({ ...categoryColumns, pageKeys: pageKeys(categoryOrder) })
    .from(categories)
    .where(and(eq(categories.householdId, ctx.householdId), keysetAfter(categoryOrder, page.after)))
    .orderBy(...keysetOrder(categoryOrder))
    .limit(page.limit + 1)
  return toPage(rows, page.limit)
}

/**
 * Gives a household every default category it doesn't have, matched by system key, so running it
 * again adds nothing. A default whose name the household already uses for its own category is
 * skipped, along with that default's children.
 */
export async function ensureDefaultCategories(actor: Actor, db: Db): Promise<{ inserted: number }> {
  authorize(actor, 'finances.manage')
  return db.transaction(async tx => {
    const values = (category: DefaultCategory, parentId: string | null) => ({
      householdId: actor.householdId,
      name: category.name,
      parentId,
      kind: category.kind,
      icon: category.icon,
      colorToken: category.colorToken,
      systemKey: category.key,
      sortOrder: category.sortOrder,
    })

    const parents = await tx
      .insert(categories)
      .values(DEFAULT_CATEGORIES.filter(c => c.parentKey === null).map(c => values(c, null)))
      .onConflictDoNothing()
      .returning({ id: categories.id })

    const seeded = await tx
      .select({ id: categories.id, systemKey: categories.systemKey })
      .from(categories)
      .where(and(eq(categories.householdId, actor.householdId), isNotNull(categories.systemKey)))
    const idsByKey = new Map(seeded.map(row => [row.systemKey, row.id]))

    const children = DEFAULT_CATEGORIES.flatMap(category => {
      if (category.parentKey === null) return []
      const parentId = idsByKey.get(category.parentKey)
      return parentId === undefined ? [] : [values(category, parentId)]
    })
    const inserted =
      children.length === 0 ? [] : await tx.insert(categories).values(children).onConflictDoNothing().returning({ id: categories.id })

    return { inserted: parents.length + inserted.length }
  })
}

function nameTaken(name: string): ConflictError {
  return new ConflictError(`You already have a category called ${name}.`)
}

export async function createCategory(
  ctx: RequestContext,
  db: Db,
  input: {
    name: string
    parentId: string | null
    kind: CategoryKind
    icon: CategoryIcon
    colorToken: CategoryColorToken
  }
): Promise<CategoryRow> {
  requirePermission(ctx, 'finances.manage')
  const name = normalizeCategoryName(input.name)
  try {
    return await db.transaction(async tx => {
      let parent: CategoryRow | null = null
      if (input.parentId !== null) {
        ;[parent = null] = await tx.select(categoryColumns).from(categories).where(categoryKey(ctx, input.parentId)).limit(1)
        if (parent === null) throw fieldError('parentId', 'Choose one of your categories.')
      }
      assertCategoryParent({ kind: input.kind, parent })

      const [last] = await tx
        .select({ sortOrder: max(categories.sortOrder) })
        .from(categories)
        .where(
          and(
            eq(categories.householdId, ctx.householdId),
            input.parentId === null ? isNull(categories.parentId) : eq(categories.parentId, input.parentId)
          )
        )

      const [category] = await tx
        .insert(categories)
        .values({
          householdId: ctx.householdId,
          name,
          parentId: input.parentId,
          kind: input.kind,
          icon: input.icon,
          colorToken: input.colorToken,
          sortOrder: (last?.sortOrder ?? -1) + 1,
        })
        .returning(categoryColumns)
      if (!category) throw new Error('Category insert returned no row')

      await recordAudit(ctx, tx, {
        action: 'category.created',
        entity: 'category',
        entityId: category.id,
        metadata: { name, kind: input.kind },
      })
      return category
    })
  } catch (error) {
    if (isUniqueViolation(error, 'categories_household_name_unique')) throw nameTaken(name)
    throw error
  }
}

/** Renames or restyles a category. Its place in the tree and its kind stay as they are. */
export async function updateCategory(
  ctx: RequestContext,
  db: Db,
  input: {
    categoryId: string
    name?: string
    icon?: CategoryIcon
    colorToken?: CategoryColorToken
    sortOrder?: number
  }
): Promise<CategoryRow> {
  requirePermission(ctx, 'finances.manage')
  const name = input.name === undefined ? undefined : normalizeCategoryName(input.name)
  const changes = {
    ...(name === undefined ? {} : { name }),
    ...(input.icon === undefined ? {} : { icon: input.icon }),
    ...(input.colorToken === undefined ? {} : { colorToken: input.colorToken }),
    ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
  }
  try {
    return await db.transaction(async tx => {
      const key = categoryKey(ctx, input.categoryId)
      const [category] =
        Object.keys(changes).length === 0
          ? await tx.select(categoryColumns).from(categories).where(key).limit(1)
          : await tx.update(categories).set(changes).where(key).returning(categoryColumns)
      if (!category) throw new NotFoundError(CATEGORY_NOT_FOUND)

      if (Object.keys(changes).length > 0) {
        await recordAudit(ctx, tx, {
          action: 'category.updated',
          entity: 'category',
          entityId: category.id,
          metadata: { fields: Object.keys(changes) },
        })
      }
      return category
    })
  } catch (error) {
    if (name !== undefined && isUniqueViolation(error, 'categories_household_name_unique')) {
      throw nameTaken(name)
    }
    throw error
  }
}

/**
 * Archives or restores a category. Archiving a parent archives its children with it. An archived
 * category keeps its transactions and past budget lines, and drops out of pickers, rules and the
 * model's list. Restoring brings back only the category named.
 */
export async function setCategoryArchived(
  ctx: RequestContext,
  db: Db,
  input: { categoryId: string; isArchived: boolean }
): Promise<CategoryRow> {
  requirePermission(ctx, 'finances.manage')
  return db.transaction(async tx => {
    const [current] = await tx.select(categoryColumns).from(categories).where(categoryKey(ctx, input.categoryId)).limit(1).for('update')
    if (!current) throw new NotFoundError(CATEGORY_NOT_FOUND)
    if (current.isArchived === input.isArchived) return current

    if (!input.isArchived && current.parentId !== null) {
      const [parent] = await tx
        .select({ name: categories.name, isArchived: categories.isArchived })
        .from(categories)
        .where(categoryKey(ctx, current.parentId))
        .limit(1)
      assertCanRestoreCategory(parent ?? null)
    }

    const scope = input.isArchived ? or(eq(categories.id, current.id), eq(categories.parentId, current.id)) : eq(categories.id, current.id)
    await tx
      .update(categories)
      .set({ isArchived: input.isArchived })
      .where(and(eq(categories.householdId, ctx.householdId), scope))

    await recordAudit(ctx, tx, {
      action: input.isArchived ? 'category.archived' : 'category.restored',
      entity: 'category',
      entityId: current.id,
    })
    return { ...current, isArchived: input.isArchived }
  })
}

/** A category the household can put transactions in today. Throws a field error otherwise. */
async function activeCategory(ctx: RequestContext, tx: Db, categoryId: string) {
  const [category] = await tx
    .select(categoryColumns)
    .from(categories)
    .where(and(categoryKey(ctx, categoryId), eq(categories.isArchived, false)))
    .limit(1)
  if (!category) throw fieldError('categoryId', 'Choose one of your categories.')
  return category
}

// ---------------------------------------------------------------------------------------------
// Rules

export interface CategoryRuleRow {
  id: string
  matcherType: CategoryMatcherType
  matcherValue: string
  categoryId: string
  categoryName: string
  priority: number
  hitCount: number
  createdByUserId: string | null
  createdAt: Date
}

const ruleColumns = {
  id: categoryRules.id,
  matcherType: categoryRules.matcherType,
  matcherValue: categoryRules.matcherValue,
  categoryId: categoryRules.categoryId,
  categoryName: categories.name,
  priority: categoryRules.priority,
  hitCount: categoryRules.hitCount,
  createdByUserId: categoryRules.createdByUserId,
  createdAt: categoryRules.createdAt,
}

/** In the order they run. */
export async function listCategoryRules(ctx: RequestContext, db: Db): Promise<CategoryRuleRow[]> {
  requirePermission(ctx, 'finances.view')
  const rows = await db
    .select(ruleColumns)
    .from(categoryRules)
    .innerJoin(categories, eq(categories.id, categoryRules.categoryId))
    .where(eq(categoryRules.householdId, ctx.householdId))
  const order = new Map(compileRules(rows).map((compiled, index) => [compiled.rule.id, index]))
  return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
}

/**
 * Transactions nothing has categorized and nobody cleared on purpose, including ones waiting for
 * review. What a new rule applies to and what a rule suggestion counts.
 */
function openTransactions(householdId: string) {
  return and(eq(transactions.householdId, householdId), isNull(transactions.categoryId), isNull(transactions.categorySource))
}

const categorizableColumns = {
  id: transactions.id,
  merchantName: transactions.merchantName,
  name: transactions.name,
  amountCents: transactions.amountCents,
  plaidCategoryPrimary: transactions.plaidCategoryPrimary,
  plaidCategoryDetailed: transactions.plaidCategoryDetailed,
  plaidCategoryConfidence: transactions.plaidCategoryConfidence,
}

/**
 * Saves a rule and applies it straight away to the household's uncategorized transactions, so a
 * rule made today also cleans up the past. Saving a matcher that already has a rule points that
 * rule at the new category.
 */
export async function createCategoryRule(
  ctx: RequestContext,
  db: Db,
  input: {
    matcherType: CategoryMatcherType
    matcherValue: string
    categoryId: string
    priority?: number
  }
): Promise<{ rule: CategoryRuleRow; applied: number }> {
  requirePermission(ctx, 'finances.manage')
  const matcherValue = normalizeMatcherValue(input.matcherType, input.matcherValue)
  return db.transaction(async tx => {
    const category = await activeCategory(ctx, tx, input.categoryId)

    const [saved] = await tx
      .insert(categoryRules)
      .values({
        householdId: ctx.householdId,
        matcherType: input.matcherType,
        matcherValue,
        categoryId: category.id,
        priority: input.priority ?? 0,
        createdByUserId: ctx.userId,
      })
      .onConflictDoUpdate({
        target: [categoryRules.householdId, categoryRules.matcherType, categoryRules.matcherValue],
        set: { categoryId: category.id, priority: input.priority ?? 0 },
      })
      .returning({
        id: categoryRules.id,
        matcherType: categoryRules.matcherType,
        matcherValue: categoryRules.matcherValue,
        categoryId: categoryRules.categoryId,
        priority: categoryRules.priority,
        createdAt: categoryRules.createdAt,
      })
    if (!saved) throw new Error('Category rule upsert returned no row')

    const [compiled] = compileRules([saved])
    const candidates = await tx.select(categorizableColumns).from(transactions).where(openTransactions(ctx.householdId))
    const matched = compiled ? candidates.filter(candidate => firstMatchingRule(candidate, [compiled]) !== null) : []

    let applied = 0
    for (const ids of chunks(matched.map(candidate => candidate.id))) {
      const rows = await tx
        .update(transactions)
        .set({
          categoryId: category.id,
          categorySource: 'rule',
          categoryRuleId: saved.id,
          categoryConfidence: null,
          suggestedCategoryId: null,
          needsReview: false,
          updatedAt: sql`now()`,
        })
        .where(and(openTransactions(ctx.householdId), inArray(transactions.id, ids)))
        .returning({ id: transactions.id })
      applied += rows.length
    }
    if (applied > 0) {
      await tx
        .update(categoryRules)
        .set({ hitCount: sql`${categoryRules.hitCount} + ${applied}` })
        .where(eq(categoryRules.id, saved.id))
    }

    await recordAudit(ctx, tx, {
      action: 'category_rule.saved',
      entity: 'category_rule',
      entityId: saved.id,
      metadata: { matcherType: saved.matcherType, categoryId: category.id, applied },
    })

    const [rule] = await tx
      .select(ruleColumns)
      .from(categoryRules)
      .innerJoin(categories, eq(categories.id, categoryRules.categoryId))
      .where(eq(categoryRules.id, saved.id))
      .limit(1)
    if (!rule) throw new NotFoundError('That rule no longer exists.')
    return { rule, applied }
  })
}

/** Transactions the rule already categorized keep their category. */
export async function deleteCategoryRule(ctx: RequestContext, db: Db, input: { ruleId: string }): Promise<void> {
  requirePermission(ctx, 'finances.manage')
  await db.transaction(async tx => {
    const [rule] = await tx
      .delete(categoryRules)
      .where(and(eq(categoryRules.id, input.ruleId), eq(categoryRules.householdId, ctx.householdId)))
      .returning({ id: categoryRules.id, matcherType: categoryRules.matcherType })
    if (!rule) throw new NotFoundError('That rule no longer exists.')
    await recordAudit(ctx, tx, {
      action: 'category_rule.deleted',
      entity: 'category_rule',
      entityId: rule.id,
      metadata: { matcherType: rule.matcherType },
    })
  })
}

export interface RuleSuggestion {
  matcherType: 'merchant_exact'
  matcherValue: string
  categoryId: string
  categoryName: string
  /** "Trader Joe's", as the transaction names it. */
  merchantLabel: string
  /** Uncategorized transactions the rule would categorize now. */
  matchingCount: number
}

/**
 * The rule to offer after a person categorizes a transaction by hand, or null when there is
 * nothing to offer: the transaction has no category, nothing to match on, or a rule already
 * sends its merchant to that category.
 */
export async function findRuleSuggestion(ctx: RequestContext, db: Db, input: { transactionId: string }): Promise<RuleSuggestion | null> {
  requirePermission(ctx, 'finances.view')
  const [transaction] = await db
    .select({
      merchantName: transactions.merchantName,
      name: transactions.name,
      categoryId: transactions.categoryId,
      categorySource: transactions.categorySource,
      categoryName: categories.name,
    })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(eq(transactions.id, input.transactionId), eq(transactions.householdId, ctx.householdId)))
    .limit(1)
  if (!transaction?.categoryId || transaction.categorySource !== 'user') return null

  const matcher = suggestedRuleMatcher(transaction)
  if (matcher === null) return null

  const [existing] = await db
    .select({ categoryId: categoryRules.categoryId })
    .from(categoryRules)
    .where(
      and(
        eq(categoryRules.householdId, ctx.householdId),
        eq(categoryRules.matcherType, matcher.matcherType),
        eq(categoryRules.matcherValue, matcher.matcherValue)
      )
    )
    .limit(1)
  if (existing?.categoryId === transaction.categoryId) return null

  const open = await db
    .select({ merchantName: transactions.merchantName, name: transactions.name })
    .from(transactions)
    .where(openTransactions(ctx.householdId))

  return {
    ...matcher,
    categoryId: transaction.categoryId,
    categoryName: transaction.categoryName,
    merchantLabel: merchantLabel(transaction),
    matchingCount: open.filter(row => merchantKey(row) === matcher.matcherValue).length,
  }
}

// ---------------------------------------------------------------------------------------------
// Categorization runs

export interface CategorizationCandidate extends CategorizableTransaction, CategorizationState {
  /** On an account the household hid. Rules and Plaid's categories still apply; the model doesn't. */
  accountHidden: boolean
}

/** How many candidates one run loads. The rest wait for the next sync or the nightly cron. */
export const CATEGORIZATION_RUN_LIMIT = 2_000

/** The households with something left to categorize, so the nightly run skips the rest. */
export async function listHouseholdsToCategorize(db: Db): Promise<{ id: string }[]> {
  return db
    .select({ id: households.id })
    .from(households)
    .where(
      sql`exists (select 1 from ${transactions} where ${transactions.householdId} = ${households.id}
        and ${transactions.categoryId} is null and ${transactions.categorySource} is null and ${transactions.needsReview} = false)`
    )
}

/**
 * Everything a categorization run needs for one household, newest transactions first. Charges
 * typed in by hand are candidates too: they reach the review queue, so they get the same chance
 * of being filed before anyone is asked.
 */
export async function loadCategorizationInput(
  actor: Actor,
  db: Db,
  options: { limit?: number } = {}
): Promise<{
  candidates: CategorizationCandidate[]
  rules: CategoryRuleInput[]
  categories: CategorizationCategory[]
}> {
  authorize(actor, 'finances.manage')
  const candidates = await db
    .select({
      ...categorizableColumns,
      categoryId: transactions.categoryId,
      categorySource: transactions.categorySource,
      needsReview: transactions.needsReview,
      isExcluded: transactions.isExcluded,
      // A charge typed in by hand is on no account, and is never out of sight.
      accountHidden: sql<boolean>`coalesce(${accounts.isHidden}, false)`,
    })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(openTransactions(actor.householdId), eq(transactions.needsReview, false)))
    .orderBy(desc(transactions.date), desc(transactions.id))
    .limit(options.limit ?? CATEGORIZATION_RUN_LIMIT)

  const rules = await db
    .select({
      id: categoryRules.id,
      matcherType: categoryRules.matcherType,
      matcherValue: categoryRules.matcherValue,
      categoryId: categoryRules.categoryId,
      priority: categoryRules.priority,
      createdAt: categoryRules.createdAt,
    })
    .from(categoryRules)
    .where(eq(categoryRules.householdId, actor.householdId))

  const categoryRows = await db
    .select({
      id: categories.id,
      name: categories.name,
      parentId: categories.parentId,
      kind: categories.kind,
      systemKey: categories.systemKey,
      isArchived: categories.isArchived,
    })
    .from(categories)
    .where(eq(categories.householdId, actor.householdId))
    .orderBy(asc(categories.sortOrder), asc(categories.name))

  return { candidates, rules, categories: categoryRows }
}

/** Still untouched: a person, a rule or an earlier run may have got there during this one. */
function stillOpen(householdId: string, ids: string[]) {
  return and(openTransactions(householdId), eq(transactions.needsReview, false), inArray(transactions.id, ids))
}

async function activeCategoryIds(actor: Actor, tx: Db): Promise<Set<string>> {
  const rows = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.householdId, actor.householdId), eq(categories.isArchived, false)))
  return new Set(rows.map(row => row.id))
}

/** Stores what the rules and Plaid's categories decided, and counts each rule's hits. */
export async function applyCategoryAssignments(
  actor: Actor,
  db: Db,
  assignments: readonly DeterministicAssignment[]
): Promise<{ byRule: number; byPfc: number }> {
  authorize(actor, 'finances.manage')
  if (assignments.length === 0) return { byRule: 0, byPfc: 0 }
  return db.transaction(async tx => {
    const active = await activeCategoryIds(actor, tx)
    const groups = new Map<string, { assignment: DeterministicAssignment; ids: string[] }>()
    for (const assignment of assignments) {
      if (!active.has(assignment.categoryId)) continue
      const ruleId = assignment.source === 'rule' ? assignment.ruleId : ''
      const key = `${assignment.source}:${assignment.categoryId}:${ruleId}`
      const group = groups.get(key) ?? { assignment, ids: [] }
      group.ids.push(assignment.transactionId)
      groups.set(key, group)
    }

    const counts = { byRule: 0, byPfc: 0 }
    const hits = new Map<string, number>()
    for (const { assignment, ids } of groups.values()) {
      for (const batch of chunks(ids)) {
        const rows = await tx
          .update(transactions)
          .set({
            categoryId: assignment.categoryId,
            categorySource: assignment.source,
            categoryRuleId: assignment.source === 'rule' ? assignment.ruleId : null,
            categoryConfidence: null,
            suggestedCategoryId: null,
            updatedAt: sql`now()`,
          })
          .where(stillOpen(actor.householdId, batch))
          .returning({ id: transactions.id })
        if (assignment.source === 'rule') {
          counts.byRule += rows.length
          hits.set(assignment.ruleId, (hits.get(assignment.ruleId) ?? 0) + rows.length)
        } else {
          counts.byPfc += rows.length
        }
      }
    }

    for (const [ruleId, hitCount] of hits) {
      if (hitCount === 0) continue
      await tx
        .update(categoryRules)
        .set({ hitCount: sql`${categoryRules.hitCount} + ${hitCount}` })
        .where(and(eq(categoryRules.id, ruleId), eq(categoryRules.householdId, actor.householdId)))
    }
    return counts
  })
}

/**
 * Stores one batch of the model's answers. A confident answer becomes the category; anything else
 * leaves the transaction uncategorized, flagged for review with the model's guess as a suggestion.
 * Never touches a transaction that a person has categorized or excluded since the run loaded it.
 */
export async function applyModelOutcomes(
  actor: Actor,
  db: Db,
  outcomes: readonly LlmOutcome[]
): Promise<{ byLlm: number; flagged: number }> {
  authorize(actor, 'finances.manage')
  if (outcomes.length === 0) return { byLlm: 0, flagged: 0 }
  return db.transaction(async tx => {
    const active = await activeCategoryIds(actor, tx)
    const counts = { byLlm: 0, flagged: 0 }
    for (const outcome of outcomes) {
      const where = and(stillOpen(actor.householdId, [outcome.transactionId]), eq(transactions.isExcluded, false))
      const assigned = outcome.kind === 'assigned' && active.has(outcome.categoryId)
      const suggested =
        outcome.kind === 'flagged' && outcome.suggestedCategoryId !== null && active.has(outcome.suggestedCategoryId)
          ? outcome.suggestedCategoryId
          : null
      const rows = await tx
        .update(transactions)
        .set(
          assigned
            ? {
                categoryId: outcome.categoryId,
                categorySource: 'llm',
                categoryConfidence: outcome.confidencePercent,
                categoryRuleId: null,
                suggestedCategoryId: null,
                updatedAt: sql`now()`,
              }
            : {
                categoryConfidence: outcome.confidencePercent,
                suggestedCategoryId: suggested,
                needsReview: true,
                updatedAt: sql`now()`,
              }
        )
        .where(where)
        .returning({ id: transactions.id })
      if (assigned) counts.byLlm += rows.length
      else counts.flagged += rows.length
    }
    return counts
  })
}

// ---------------------------------------------------------------------------------------------
// Spending

/**
 * Money that counts as spending between two dates: not excluded, not a transfer, not on a hidden
 * account. A charge typed in by hand belongs to no account and is always the household's own, so
 * the cash dinner counts towards a budget like everything else. Uncategorized money coming in
 * isn't spending, so only money out counts there. Categorized refunds count against their category.
 */
function spendingConditions(householdId: string, from: CalendarDate, to: CalendarDate) {
  return and(
    eq(transactions.householdId, householdId),
    gte(transactions.date, from),
    lt(transactions.date, to),
    eq(transactions.isExcluded, false),
    eq(transactions.isTransfer, false),
    or(isNull(transactions.accountId), eq(accounts.isHidden, false)),
    or(isNotNull(transactions.categoryId), lt(transactions.amountCents, 0))
  )
}

const spentCents = sql<number>`-sum(${transactions.amountCents})`.mapWith(Number)

/** Spending per category in [from, to). Positive is money spent. */
export async function listCategorySpend(
  ctx: RequestContext,
  db: Db,
  input: { from: CalendarDate; to: CalendarDate }
): Promise<CategorySpend[]> {
  requirePermission(ctx, 'finances.view')
  return db
    .select({ categoryId: transactions.categoryId, spentCents })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(spendingConditions(ctx.householdId, input.from, input.to))
    .groupBy(transactions.categoryId)
}

/** Spending per category per month in [from, to). */
export async function listMonthlyCategorySpend(
  ctx: RequestContext,
  db: Db,
  input: { from: CalendarDate; to: CalendarDate }
): Promise<MonthlyCategorySpend[]> {
  requirePermission(ctx, 'finances.view')
  const month = sql<string>`to_char(${transactions.date}, 'YYYY-MM') || '-01'`
  return db
    .select({ month, categoryId: transactions.categoryId, spentCents })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(spendingConditions(ctx.householdId, input.from, input.to))
    .groupBy(month, transactions.categoryId)
}

export interface MerchantSpend {
  merchant: string
  spentCents: number
  transactionCount: number
}

/** Where the money went in [from, to): money out in expense categories or none, by merchant. */
export async function listTopMerchants(
  ctx: RequestContext,
  db: Db,
  input: { from: CalendarDate; to: CalendarDate; limit: number }
): Promise<MerchantSpend[]> {
  requirePermission(ctx, 'finances.view')
  const merchant = sql`coalesce(nullif(trim(${transactions.merchantName}), ''), ${transactions.name})`
  const total = sql<number>`-sum(${transactions.amountCents})`.mapWith(Number)
  return db
    .select({
      merchant: sql<string>`min(${merchant})`,
      spentCents: total,
      transactionCount: count(),
    })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        spendingConditions(ctx.householdId, input.from, input.to),
        lt(transactions.amountCents, 0),
        or(isNull(categories.kind), eq(categories.kind, 'expense'))
      )
    )
    .groupBy(sql`lower(${merchant})`)
    .orderBy(desc(total))
    .limit(input.limit)
}

// ---------------------------------------------------------------------------------------------
// Budgets

export interface BudgetRow {
  id: string
  periodStart: CalendarDate
  closedAt: Date | null
  unbudgetedCents: number | null
  uncategorizedCents: number | null
}

export type BudgetLineRow = BudgetLineInput

const budgetColumns = {
  id: budgets.id,
  periodStart: budgets.periodStart,
  closedAt: budgets.closedAt,
  unbudgetedCents: budgets.unbudgetedCents,
  uncategorizedCents: budgets.uncategorizedCents,
}

const lineColumns = {
  id: budgetLines.id,
  categoryId: budgetLines.categoryId,
  plannedCents: budgetLines.plannedCents,
  rolloverEnabled: budgetLines.rolloverEnabled,
  rolloverInCents: budgetLines.rolloverInCents,
  actualCents: budgetLines.actualCents,
}

async function findBudget(
  householdId: string,
  tx: Db,
  periodStart: CalendarDate,
  options: { lock?: boolean } = {}
): Promise<BudgetRow | null> {
  const query = tx
    .select(budgetColumns)
    .from(budgets)
    .where(and(eq(budgets.householdId, householdId), eq(budgets.periodStart, periodStart)))
    .limit(1)
  const [budget] = options.lock ? await query.for('update') : await query
  return budget ?? null
}

async function linesFor(tx: Db, budgetId: string): Promise<BudgetLineRow[]> {
  return tx
    .select(lineColumns)
    .from(budgetLines)
    .innerJoin(categories, eq(categories.id, budgetLines.categoryId))
    .where(eq(budgetLines.budgetId, budgetId))
    .orderBy(asc(categories.sortOrder), asc(categories.name))
}

async function budgetCategories(householdId: string, tx: Db) {
  return tx
    .select({ id: categories.id, parentId: categories.parentId, kind: categories.kind })
    .from(categories)
    .where(eq(categories.householdId, householdId))
}

async function summarize(
  ctx: RequestContext,
  tx: Db,
  input: {
    budget: BudgetRow | null
    lines: BudgetLineRow[]
    periodStart: CalendarDate
    elapsed: number
  }
): Promise<BudgetSummary> {
  const { budget } = input
  const closed =
    budget?.closedAt != null && budget.unbudgetedCents !== null && budget.uncategorizedCents !== null
      ? { unbudgetedCents: budget.unbudgetedCents, uncategorizedCents: budget.uncategorizedCents }
      : null
  return summarizeBudget({
    lines: input.lines,
    categories: await budgetCategories(ctx.householdId, tx),
    spend: await listCategorySpend(ctx, tx, {
      from: input.periodStart,
      to: periodEnd(input.periodStart),
    }),
    elapsedShare: closed ? 1 : input.elapsed,
    snapshot: closed,
  })
}

export interface BudgetPeriod {
  periodStart: CalendarDate
  /** Null until someone plans the month. Spending still shows. */
  budget: BudgetRow | null
  lines: BudgetLineRow[]
  summary: BudgetSummary
  /** Whether the month before has a budget to copy. */
  previousHasLines: boolean
}

/** A month's plan against what it spent. `today` is the household's date. */
export async function getBudgetPeriod(
  ctx: RequestContext,
  db: Db,
  input: { periodStart: string; today: CalendarDate }
): Promise<BudgetPeriod> {
  requirePermission(ctx, 'finances.view')
  const periodStart = assertMonthStart(input.periodStart)
  const budget = await findBudget(ctx.householdId, db, periodStart)
  const lines = budget ? await linesFor(db, budget.id) : []
  const previous = await findBudget(ctx.householdId, db, addMonths(periodStart, -1))
  const [previousLines] = previous ? await db.select({ total: count() }).from(budgetLines).where(eq(budgetLines.budgetId, previous.id)) : []
  return {
    periodStart,
    budget,
    lines,
    summary: await summarize(ctx, db, {
      budget,
      lines,
      periodStart,
      elapsed: elapsedShare(periodStart, input.today),
    }),
    previousHasLines: (previousLines?.total ?? 0) > 0,
  }
}

function monthClosed(periodStart: CalendarDate): ConflictError {
  const [year, month] = periodStart.split('-')
  return new ConflictError(`${year}-${month} is closed. Its budget can't change.`)
}

/** The month's budget, created if it doesn't exist. Throws if it's closed. */
async function openBudget(ctx: RequestContext, tx: Db, periodStart: CalendarDate) {
  await tx
    .insert(budgets)
    .values({ householdId: ctx.householdId, periodStart })
    .onConflictDoNothing({ target: [budgets.householdId, budgets.periodStart] })
  const budget = await findBudget(ctx.householdId, tx, periodStart, { lock: true })
  if (!budget) throw new Error('Budget upsert found no row')
  if (budget.closedAt !== null) throw monthClosed(periodStart)
  return budget
}

/**
 * Plans one category for a month. A new line on a category that rolled over from a closed month
 * picks up what that month carried.
 */
export async function setBudgetLine(
  ctx: RequestContext,
  db: Db,
  input: {
    periodStart: string
    categoryId: string
    plannedCents: number
    rolloverEnabled: boolean
  }
): Promise<BudgetLineRow> {
  requirePermission(ctx, 'finances.manage')
  const periodStart = assertMonthStart(input.periodStart)
  const plannedCents = assertPlannedCents(input.plannedCents)
  return db.transaction(async tx => {
    const category = await activeCategory(ctx, tx, input.categoryId)
    assertBudgetableCategory(category)
    const budget = await openBudget(ctx, tx, periodStart)

    const previous = await findBudget(ctx.householdId, tx, addMonths(periodStart, -1))
    const [previousLine] = previous
      ? await tx
          .select(lineColumns)
          .from(budgetLines)
          .where(and(eq(budgetLines.budgetId, previous.id), eq(budgetLines.categoryId, category.id)))
          .limit(1)
      : []
    const [carried] = previousLine ? copyBudgetLines({ lines: [previousLine], closed: previous?.closedAt != null }) : []

    const [line] = await tx
      .insert(budgetLines)
      .values({
        budgetId: budget.id,
        categoryId: category.id,
        plannedCents,
        rolloverEnabled: input.rolloverEnabled,
        rolloverInCents: carried?.rolloverInCents ?? 0,
      })
      .onConflictDoUpdate({
        target: [budgetLines.budgetId, budgetLines.categoryId],
        set: { plannedCents, rolloverEnabled: input.rolloverEnabled },
      })
      .returning(lineColumns)
    if (!line) throw new Error('Budget line upsert returned no row')

    await recordAudit(ctx, tx, {
      action: 'budget_line.saved',
      entity: 'budget_line',
      entityId: line.id,
      metadata: { periodStart, categoryId: category.id, plannedCents },
    })
    return line
  })
}

export async function deleteBudgetLine(ctx: RequestContext, db: Db, input: { lineId: string }): Promise<void> {
  requirePermission(ctx, 'finances.manage')
  await db.transaction(async tx => {
    const [line] = await tx
      .select({ id: budgetLines.id, periodStart: budgets.periodStart, closedAt: budgets.closedAt })
      .from(budgetLines)
      .innerJoin(budgets, eq(budgets.id, budgetLines.budgetId))
      .where(and(eq(budgetLines.id, input.lineId), eq(budgets.householdId, ctx.householdId)))
      .limit(1)
      .for('update')
    if (!line) throw new NotFoundError('That budget line no longer exists.')
    if (line.closedAt !== null) throw monthClosed(line.periodStart)

    await tx.delete(budgetLines).where(eq(budgetLines.id, line.id))
    await recordAudit(ctx, tx, {
      action: 'budget_line.deleted',
      entity: 'budget_line',
      entityId: line.id,
      metadata: { periodStart: line.periodStart },
    })
  })
}

/**
 * Copies the month before's lines into this month: its plans, its rollover settings and, when it
 * is closed, what each rollover line carries. Lines this month already has are left alone, as are
 * archived categories.
 */
export async function copyPreviousBudget(ctx: RequestContext, db: Db, input: { periodStart: string }): Promise<{ copied: number }> {
  requirePermission(ctx, 'finances.manage')
  const periodStart = assertMonthStart(input.periodStart)
  return db.transaction(async tx => {
    const previous = await findBudget(ctx.householdId, tx, addMonths(periodStart, -1))
    const previousLines = previous
      ? await tx
          .select(lineColumns)
          .from(budgetLines)
          .innerJoin(categories, eq(categories.id, budgetLines.categoryId))
          .where(and(eq(budgetLines.budgetId, previous.id), eq(categories.isArchived, false)))
      : []
    if (!previous || previousLines.length === 0) {
      throw new NotFoundError('The month before has no budget to copy.')
    }

    const budget = await openBudget(ctx, tx, periodStart)
    const copied = await tx
      .insert(budgetLines)
      .values(copyBudgetLines({ lines: previousLines, closed: previous.closedAt !== null }).map(line => ({ budgetId: budget.id, ...line })))
      .onConflictDoNothing({ target: [budgetLines.budgetId, budgetLines.categoryId] })
      .returning({ id: budgetLines.id })

    await recordAudit(ctx, tx, {
      action: 'budget.copied',
      entity: 'budget',
      entityId: budget.id,
      metadata: { periodStart, from: previous.periodStart, copied: copied.length },
    })
    return { copied: copied.length }
  })
}

/**
 * Closes a month that has ended: stores each line's actual and what spending fell outside the
 * lines, so later bank changes don't rewrite it, and carries rollover lines into next month's
 * budget if it has one. A next month planned later picks the rollovers up when its lines are made.
 */
export async function closeBudgetPeriod(
  ctx: RequestContext,
  db: Db,
  input: { periodStart: string; today: CalendarDate; now: Date }
): Promise<BudgetPeriod> {
  requirePermission(ctx, 'finances.manage')
  const periodStart = assertMonthStart(input.periodStart)
  await db.transaction(async tx => {
    const budget = await openBudgetForClose(ctx, tx, periodStart, input.today)
    const lines = await linesFor(tx, budget.id)
    const closing = closeBudget(await summarize(ctx, tx, { budget, lines, periodStart, elapsed: 1 }))

    for (const line of closing.lines) {
      await tx
        .update(budgetLines)
        .set({ actualCents: line.actualCents })
        .where(and(eq(budgetLines.id, line.id), eq(budgetLines.budgetId, budget.id)))
    }
    await tx
      .update(budgets)
      .set({
        closedAt: input.now,
        unbudgetedCents: closing.unbudgetedCents,
        uncategorizedCents: closing.uncategorizedCents,
      })
      .where(eq(budgets.id, budget.id))

    const next = await findBudget(ctx.householdId, tx, addMonths(periodStart, 1), { lock: true })
    if (next && next.closedAt === null) {
      for (const rollover of closing.rollovers) {
        await tx
          .update(budgetLines)
          .set({ rolloverInCents: rollover.rolloverInCents })
          .where(and(eq(budgetLines.budgetId, next.id), eq(budgetLines.categoryId, rollover.categoryId)))
      }
    }

    await recordAudit(ctx, tx, {
      action: 'budget.closed',
      entity: 'budget',
      entityId: budget.id,
      metadata: {
        periodStart,
        unbudgetedCents: closing.unbudgetedCents,
        uncategorizedCents: closing.uncategorizedCents,
        rollovers: closing.rollovers.length,
      },
    })
  })
  return getBudgetPeriod(ctx, db, { periodStart, today: input.today })
}

async function openBudgetForClose(ctx: RequestContext, tx: Db, periodStart: CalendarDate, today: CalendarDate): Promise<BudgetRow> {
  await tx
    .insert(budgets)
    .values({ householdId: ctx.householdId, periodStart })
    .onConflictDoNothing({ target: [budgets.householdId, budgets.periodStart] })
  const budget = await findBudget(ctx.householdId, tx, periodStart, { lock: true })
  if (!budget) throw new Error('Budget upsert found no row')
  assertCanCloseBudget({ periodStart, closedAt: budget.closedAt, today })
  return budget
}

// ---------------------------------------------------------------------------------------------
// Goals

export interface GoalRow {
  id: string
  name: string
  targetCents: number
  targetDate: CalendarDate | null
  notes: string | null
  createdAt: Date
  linkedAccount: {
    id: string
    name: string
    mask: string | null
    type: string
    currentBalanceCents: number | null
  } | null
}

function selectGoals(db: Db) {
  return db
    .select({
      id: goals.id,
      name: goals.name,
      targetCents: goals.targetCents,
      targetDate: goals.targetDate,
      notes: goals.notes,
      createdAt: goals.createdAt,
      accountId: accounts.id,
      accountName: accounts.name,
      accountMask: accounts.mask,
      accountType: accounts.type,
      accountBalanceCents: accounts.currentBalanceCents,
    })
    .from(goals)
    .leftJoin(accounts, eq(accounts.id, goals.linkedAccountId))
}

type SelectedGoal = Awaited<ReturnType<ReturnType<typeof selectGoals>['execute']>>[number]

function toGoalRow(row: SelectedGoal): GoalRow {
  return {
    id: row.id,
    name: row.name,
    targetCents: row.targetCents,
    targetDate: row.targetDate,
    notes: row.notes,
    createdAt: row.createdAt,
    linkedAccount:
      row.accountId === null || row.accountName === null || row.accountType === null
        ? null
        : {
            id: row.accountId,
            name: row.accountName,
            mask: row.accountMask,
            type: row.accountType,
            currentBalanceCents: row.accountBalanceCents,
          },
  }
}

const GOAL_NOT_FOUND = 'That goal no longer exists.'

function goalKey(ctx: RequestContext, goalId: string) {
  return and(eq(goals.id, goalId), eq(goals.householdId, ctx.householdId))
}

export async function listGoals(ctx: RequestContext, db: Db): Promise<GoalRow[]> {
  requirePermission(ctx, 'finances.view')
  const rows = await selectGoals(db).where(eq(goals.householdId, ctx.householdId)).orderBy(asc(goals.createdAt), asc(goals.id))
  return rows.map(toGoalRow)
}

export interface GoalInput extends GoalFields {
  linkedAccountId: string | null
}

async function assertHouseholdAccount(ctx: RequestContext, tx: Db, accountId: string | null) {
  if (accountId === null) return
  const [account] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.householdId, ctx.householdId)))
    .limit(1)
  if (!account) throw fieldError('linkedAccountId', 'Choose one of your accounts.')
}

export async function createGoal(ctx: RequestContext, db: Db, input: GoalInput): Promise<GoalRow> {
  requirePermission(ctx, 'finances.manage')
  const fields = validateGoal(input)
  return db.transaction(async tx => {
    await assertHouseholdAccount(ctx, tx, input.linkedAccountId)
    const [goal] = await tx
      .insert(goals)
      .values({ householdId: ctx.householdId, ...fields, linkedAccountId: input.linkedAccountId })
      .returning({ id: goals.id })
    if (!goal) throw new Error('Goal insert returned no row')
    await recordAudit(ctx, tx, { action: 'goal.created', entity: 'goal', entityId: goal.id })
    const [row] = await selectGoals(tx).where(goalKey(ctx, goal.id)).limit(1)
    if (!row) throw new NotFoundError(GOAL_NOT_FOUND)
    return toGoalRow(row)
  })
}

export async function updateGoal(ctx: RequestContext, db: Db, input: GoalInput & { goalId: string }): Promise<GoalRow> {
  requirePermission(ctx, 'finances.manage')
  const fields = validateGoal(input)
  return db.transaction(async tx => {
    await assertHouseholdAccount(ctx, tx, input.linkedAccountId)
    const [goal] = await tx
      .update(goals)
      .set({ ...fields, linkedAccountId: input.linkedAccountId })
      .where(goalKey(ctx, input.goalId))
      .returning({ id: goals.id })
    if (!goal) throw new NotFoundError(GOAL_NOT_FOUND)
    await recordAudit(ctx, tx, { action: 'goal.updated', entity: 'goal', entityId: goal.id })
    const [row] = await selectGoals(tx).where(goalKey(ctx, goal.id)).limit(1)
    if (!row) throw new NotFoundError(GOAL_NOT_FOUND)
    return toGoalRow(row)
  })
}

export async function deleteGoal(ctx: RequestContext, db: Db, input: { goalId: string }): Promise<void> {
  requirePermission(ctx, 'finances.manage')
  await db.transaction(async tx => {
    const [goal] = await tx.delete(goals).where(goalKey(ctx, input.goalId)).returning({ id: goals.id })
    if (!goal) throw new NotFoundError(GOAL_NOT_FOUND)
    await recordAudit(ctx, tx, { action: 'goal.deleted', entity: 'goal', entityId: goal.id })
  })
}

// ---------------------------------------------------------------------------------------------

const CHUNK = 500

function* chunks<T>(items: readonly T[]): Generator<T[]> {
  for (let start = 0; start < items.length; start += CHUNK) {
    yield items.slice(start, start + CHUNK)
  }
}
