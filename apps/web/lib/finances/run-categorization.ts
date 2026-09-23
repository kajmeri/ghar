import 'server-only'
import {
  buildCategorizationPrompt,
  canAskModel,
  categorizeDeterministic,
  chunk,
  interpretCategorization,
  needsCategorization,
  LLM_BATCH_SIZE,
} from '@ghar/core/finances'
import * as queries from '@ghar/db/queries'
import type { Actor, Db, SystemContext } from '@ghar/db/queries'
import { getDb } from '@/lib/db'
import { CategorizationError, getTransactionCategorizer, type TransactionCategorizer } from '@/lib/providers/categorize'

// Giving new transactions a category. The waterfall itself is pure and lives in
// @ghar/core/finances/categorize; this loads the rows, calls the model for what the first two
// layers missed, and stores the answers.
//
// It runs twice over the same transactions on purpose. A sync runs it with askModel off, so the
// moment a bank finishes syncing a household sees the categories its rules and Plaid's own
// categories already imply, without waiting on a model. The nightly cron then runs it in full and
// asks the model about the rest.
//
// Nothing here ever fails the thing that called it. A batch the model can't answer is left exactly
// as it was and counted as deferred, so the next run picks it up; that is better than flagging a
// household's transactions for review because Anthropic was down for a minute.

export interface CategorizationDeps {
  db: Db
  /** Resolved only when there is a batch to send, so a deterministic run needs no API key. */
  categorizer: () => TransactionCategorizer
}

export function categorizationDeps(db: Db = getDb()): CategorizationDeps {
  return { db, categorizer: getTransactionCategorizer }
}

/**
 * Batches one household gets per run, which caps both the cron's time and a day's spend. At
 * LLM_BATCH_SIZE each, the rest waits for tomorrow.
 */
const MAX_BATCHES_PER_HOUSEHOLD = 25

/** Failed batches in a row before a household's run gives up, so an outage costs one attempt each. */
const MAX_BATCH_FAILURES = 2

/**
 * What a run did. A type rather than an interface, so a job's result still satisfies the cron's
 * Record<string, unknown> metadata.
 */
export type CategorizationTotals = {
  /** Transactions this run looked at. */
  considered: number
  byRule: number
  byPfc: number
  byLlm: number
  /** Answered too uncertainly, or not at all, so a person decides. */
  flagged: number
  /** Batches the model answered. */
  batches: number
  /** Left untouched for the next run: over this run's cap, or the model couldn't be asked. */
  deferred: number
}

function noTotals(): CategorizationTotals {
  return { considered: 0, byRule: 0, byPfc: 0, byLlm: 0, flagged: 0, batches: 0, deferred: 0 }
}

/**
 * Categorizes what one household has open, newest first. With `askModel` off it stops after the
 * rules and Plaid's categories, and counts the remainder as deferred.
 */
export async function categorizeHousehold(
  actor: Actor,
  deps: CategorizationDeps,
  options: { askModel?: boolean; limit?: number } = {}
): Promise<CategorizationTotals> {
  const totals = noTotals()

  // A household that has never opened the categories screen has none at all, and nothing can be
  // categorized against an empty list. Running it again inserts nothing.
  await queries.ensureDefaultCategories(actor, deps.db)

  const input = await queries.loadCategorizationInput(actor, deps.db, { limit: options.limit })
  const open = input.candidates.filter(candidate => needsCategorization(candidate))
  totals.considered = open.length
  if (open.length === 0) return totals

  const { assigned, unmatched } = categorizeDeterministic(open, input)
  const stored = await queries.applyCategoryAssignments(actor, deps.db, assigned)
  totals.byRule = stored.byRule
  totals.byPfc = stored.byPfc

  // The model sees nothing a person excluded, and nothing on an account the household hid: no one
  // is going to read those categories.
  const leftOver = new Set(unmatched.map(transaction => transaction.id))
  const forModel = open.filter(candidate => leftOver.has(candidate.id) && canAskModel(candidate) && !candidate.accountHidden)
  if (forModel.length === 0) return totals
  if (options.askModel === false) {
    totals.deferred = forModel.length
    return totals
  }

  const batches = chunk(forModel, LLM_BATCH_SIZE)
  const asking = batches.slice(0, MAX_BATCHES_PER_HOUSEHOLD)
  for (const batch of batches.slice(MAX_BATCHES_PER_HOUSEHOLD)) totals.deferred += batch.length

  // Resolved once, and before the first call, so a deployment with no key fails loudly here rather
  // than once per batch.
  const categorizer = deps.categorizer()
  let failures = 0
  for (const batch of asking) {
    if (failures >= MAX_BATCH_FAILURES) {
      totals.deferred += batch.length
      continue
    }
    const prompt = buildCategorizationPrompt(batch, input.categories)
    let answer: unknown
    try {
      answer = await categorizer.categorize(prompt)
    } catch (error) {
      failures += 1
      totals.deferred += batch.length
      // The transactions stay open. Neither log says what was in the batch.
      if (error instanceof CategorizationError) console.warn(`Categorization batch skipped: ${error.message}`)
      else console.error('Categorization batch failed', error)
      continue
    }
    // An answer in the wrong shape isn't an error: interpretCategorization sends the batch to review.
    const applied = await queries.applyModelOutcomes(actor, deps.db, interpretCategorization(prompt, answer).outcomes)
    totals.byLlm += applied.byLlm
    totals.flagged += applied.flagged
    totals.batches += 1
  }

  return totals
}

export type CategorizationRunResult = CategorizationTotals & {
  households: number
  errors: number
}

/** The nightly run, over every household with something left to categorize. */
export async function runCategorization(deps: CategorizationDeps): Promise<CategorizationRunResult> {
  const result: CategorizationRunResult = { households: 0, errors: 0, ...noTotals() }
  for (const household of await queries.listHouseholdsToCategorize(deps.db)) {
    result.households += 1
    try {
      // The household comes from the stored row, never from a request.
      const actor: SystemContext = { householdId: household.id, userId: null }
      const totals = await categorizeHousehold(actor, deps)
      result.considered += totals.considered
      result.byRule += totals.byRule
      result.byPfc += totals.byPfc
      result.byLlm += totals.byLlm
      result.flagged += totals.flagged
      result.batches += totals.batches
      result.deferred += totals.deferred
    } catch (error) {
      result.errors += 1
      console.error(`Categorization failed for household ${household.id}`, error)
    }
  }
  return result
}
