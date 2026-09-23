import 'server-only'
import type { CategoryRule, CategoryRuleBody, RuleSuggestion } from '@ghar/contracts'
import * as queries from '@ghar/db/queries'
import type { Session } from '@/lib/api/authed'
import { getDb } from '@/lib/db'

// The household's filing rules, as /api/v1/finances/rules answers them. The order they run in,
// what they match and what a new one applies to are all decided in @ghar/core; this only carries
// rows across the boundary.

function toRule(row: queries.CategoryRuleRow): CategoryRule {
  return {
    id: row.id,
    matcherType: row.matcherType,
    matcherValue: row.matcherValue,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    priority: row.priority,
    hitCount: row.hitCount,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  }
}

/** In the order they run: exact merchant matches first, then by priority, then newest. */
export async function loadRules(session: Session): Promise<{ rules: CategoryRule[] }> {
  const rows = await queries.listCategoryRules(session.context, getDb())
  return { rules: rows.map(toRule) }
}

/** Saves the rule and files what it recognizes among the charges nobody has filed. */
export async function saveRule(session: Session, body: CategoryRuleBody): Promise<{ rule: CategoryRule; applied: number }> {
  const { rule, applied } = await queries.createCategoryRule(session.context, getDb(), body)
  return { rule: toRule(rule), applied }
}

/** Charges the rule filed keep their category: only the rule goes. */
export async function removeRule(session: Session, input: { ruleId: string }): Promise<void> {
  await queries.deleteCategoryRule(session.context, getDb(), input)
}

/** The rule worth offering after someone files a charge by hand, when there is one. */
export async function loadRuleSuggestion(session: Session, transactionId: string): Promise<{ suggestion: RuleSuggestion | null }> {
  const suggestion = await queries.findRuleSuggestion(session.context, getDb(), { transactionId })
  return { suggestion }
}
