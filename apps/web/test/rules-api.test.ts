import type { PGlite } from '@electric-sql/pglite'
import type { CategoryRule, RequestContext, RuleSuggestion, Transaction } from '@ghar/contracts'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { acceptInvitation, createHousehold, createInvitation, createManualTransaction, listCategories, type Db } from '@ghar/db/queries'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { DELETE as deleteRule } from '@/app/api/v1/finances/rules/[ruleId]/route'
import { GET as getRules, POST as postRule } from '@/app/api/v1/finances/rules/route'
import { GET as getSuggestion } from '@/app/api/v1/transactions/[transactionId]/rule-suggestion/route'
import { PATCH as tag } from '@/app/api/v1/transactions/[transactionId]/route'
import { GET as getTransactions } from '@/app/api/v1/transactions/route'

// /api/v1/finances/rules against PGlite: the standing instructions a household gives about where
// a merchant's charges go, what a new one does to the charges already waiting, and what filing one
// charge by hand offers to turn into a rule.

const test = vi.hoisted(() => ({ db: undefined as unknown, session: null as RequestContext | null }))

vi.mock('@/lib/db', () => ({ getDb: () => test.db }))
vi.mock('@/lib/auth/context', async () => {
  const { UnauthorizedError } = await import('@ghar/core/errors')
  const getRequestContext = () =>
    test.session ? Promise.resolve(test.session) : Promise.reject(new UnauthorizedError('Sign in to continue.'))
  return { getRequestContext, getPageContext: getRequestContext }
})

let client: PGlite
let db: Db
let owner: RequestContext
let member: RequestContext
let groceries: string
let coffee: string

async function readRules(): Promise<{ status: number; body: { rules: CategoryRule[] } }> {
  const response = await getRules(new Request('http://localhost/api/v1/finances/rules'), { params: Promise.resolve({}) })
  return { status: response.status, body: (await response.json()) as { rules: CategoryRule[] } }
}

async function saveRule(body: unknown): Promise<{ status: number; body: { rule: CategoryRule; applied: number } }> {
  const response = await postRule(
    new Request('http://localhost/api/v1/finances/rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) }
  )
  return { status: response.status, body: (await response.json()) as { rule: CategoryRule; applied: number } }
}

async function dropRule(ruleId: string): Promise<{ status: number; body: { ruleId: string } }> {
  const response = await deleteRule(new Request(`http://localhost/api/v1/finances/rules/${ruleId}`, { method: 'DELETE' }), {
    params: Promise.resolve({ ruleId }),
  })
  return { status: response.status, body: (await response.json()) as { ruleId: string } }
}

async function readSuggestion(transactionId: string): Promise<{ status: number; body: { suggestion: RuleSuggestion | null } }> {
  const response = await getSuggestion(new Request(`http://localhost/api/v1/transactions/${transactionId}/rule-suggestion`), {
    params: Promise.resolve({ transactionId }),
  })
  return { status: response.status, body: (await response.json()) as { suggestion: RuleSuggestion | null } }
}

/** A charge typed in by hand, the way a person adds one the bank hasn't sent. */
async function charge(name: string, merchantName: string | null, amountCents: number): Promise<string> {
  const row = await createManualTransaction(owner, db, { date: '2026-09-14', name, merchantName, amountCents, tripId: null })
  return row.id
}

/** Files a charge the way the transaction sheet files one: by hand, as a person. */
async function fileByHand(transactionId: string, categoryId: string): Promise<void> {
  await tag(
    new Request(`http://localhost/api/v1/transactions/${transactionId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ categoryId }),
    }),
    { params: Promise.resolve({ transactionId }) }
  )
}

async function transactionNamed(name: string): Promise<Transaction | undefined> {
  const response = await getTransactions(new Request('http://localhost/api/v1/transactions?limit=100'), { params: Promise.resolve({}) })
  const { items } = (await response.json()) as { items: Transaction[] }
  return items.find(item => item.description === name)
}

async function categoryKeyed(systemKey: string): Promise<string> {
  const category = (await listCategories(owner, db)).find(row => row.systemKey === systemKey)
  if (!category) throw new Error(`No ${systemKey} category`)
  return category.id
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  test.db = db

  const ownerId = await createAuthUser(client, 'rules-owner@example.com')
  const { household } = await createHousehold({ userId: ownerId, email: 'rules-owner@example.com' }, db, {
    name: 'The Rao household',
    timezone: 'America/Chicago',
    currency: 'USD',
  })
  owner = { userId: ownerId, householdId: household.id, role: 'owner' }

  const memberId = await createAuthUser(client, 'rules-member@example.com')
  await createInvitation(owner, db, {
    email: 'rules-member@example.com',
    role: 'member',
    tokenHash: 'rules-hash-member',
    expiresAt: invitationExpiresAt(new Date()),
  })
  await acceptInvitation({ userId: memberId, email: 'rules-member@example.com' }, db, {
    tokenHash: 'rules-hash-member',
    now: new Date(),
  })
  member = { userId: memberId, householdId: household.id, role: 'member' }

  groceries = await categoryKeyed('groceries')
  coffee = await categoryKeyed('coffee')

  test.session = owner
  await charge('TRADER JOES 455', 'Trader Joe’s', -8400)
  await charge('TRADER JOES 455', 'trader joe’s  ', -3100)
  await charge('CORNER CAFE', 'Corner Cafe', -600)
  await charge('SQ *FARM STAND', null, -2200)
  await charge('BLUE BOTTLE 41 GRAND', 'Blue Bottle Coffee', -700)
  await charge('BLUE BOTTLE 41 GRAND', 'Blue Bottle Coffee', -450)
}, 60_000)

afterAll(async () => {
  await client.close()
})

describe('rules that file charges', () => {
  it('has none until someone writes one', async () => {
    test.session = owner
    const { status, body } = await readRules()
    expect(status).toBe(200)
    expect(body.rules).toEqual([])
  })

  it('files the charges that were already waiting, and says how many', async () => {
    test.session = owner
    const { status, body } = await saveRule({ matcherType: 'merchant_exact', matcherValue: '  Trader Joe’s ', categoryId: groceries })

    expect(status).toBe(201)
    // The merchant is stored the way merchants are compared: trimmed, single spaces, lowercase.
    expect(body.rule).toMatchObject({ matcherType: 'merchant_exact', matcherValue: 'trader joe’s', categoryId: groceries, priority: 0 })
    expect(body.applied).toBe(2)
    expect(body.rule.createdByUserId).toBe(owner.userId)

    const filed = await transactionNamed('TRADER JOES 455')
    expect(filed).toMatchObject({ categoryId: groceries, categorySource: 'rule', needsReview: false })
    // The cafe and the farm stand are nobody's business but their own.
    expect((await transactionNamed('CORNER CAFE'))?.categoryId).toBeNull()
  })

  it('counts what it has filed', async () => {
    test.session = owner
    const [rule] = (await readRules()).body.rules
    expect(rule?.hitCount).toBe(2)
    expect(rule?.categoryName).toBe('Groceries')
  })

  it('points an existing rule somewhere else rather than writing a second one', async () => {
    test.session = owner
    const before = (await readRules()).body.rules
    const again = await saveRule({ matcherType: 'merchant_exact', matcherValue: 'TRADER JOE’S', categoryId: coffee, priority: 5 })

    expect(again.body.rule.id).toBe(before[0]?.id)
    expect(again.body.rule).toMatchObject({ categoryId: coffee, priority: 5 })
    // Nothing was left waiting, so it filed nothing new, and the charges it filed before stay put.
    expect(again.body.applied).toBe(0)
    expect((await readRules()).body.rules).toHaveLength(1)
    expect((await transactionNamed('TRADER JOES 455'))?.categoryId).toBe(groceries)

    await saveRule({ matcherType: 'merchant_exact', matcherValue: 'Trader Joe’s', categoryId: groceries })
  })

  it('refuses a matcher it can’t make sense of, and a category from another household', async () => {
    test.session = owner
    expect((await saveRule({ matcherType: 'amount_range', matcherValue: 'small', categoryId: groceries })).status).toBe(400)
    expect((await saveRule({ matcherType: 'name_regex', matcherValue: 'farm(', categoryId: groceries })).status).toBe(400)
    // A category id that isn't one of ours is a bad answer in a form, not a missing page.
    expect((await saveRule({ matcherType: 'merchant_exact', matcherValue: 'Anyone', categoryId: crypto.randomUUID() })).status).toBe(400)
  })

  it('runs exact merchants first, then whatever was given the higher priority', async () => {
    test.session = owner
    await saveRule({ matcherType: 'name_regex', matcherValue: '^SQ \\*', categoryId: groceries, priority: 1 })
    await saveRule({ matcherType: 'merchant_contains', matcherValue: 'cafe', categoryId: coffee, priority: 9 })

    const { rules } = (await readRules()).body
    expect(rules.map(rule => rule.matcherType)).toEqual(['merchant_exact', 'merchant_contains', 'name_regex'])
    // The pattern rule caught the charge with no merchant on it.
    expect((await transactionNamed('SQ *FARM STAND'))?.categoryId).toBe(groceries)
  })

  it('offers a rule after a charge is filed by hand, and stops offering once there is one', async () => {
    test.session = owner
    const cup = await transactionNamed('BLUE BOTTLE 41 GRAND')
    const cupId = cup?.id ?? ''
    // Before anyone files it, there is nothing to learn from.
    expect((await readSuggestion(cupId)).body.suggestion).toBeNull()

    await fileByHand(cupId, coffee)
    const offered = await readSuggestion(cupId)
    expect(offered.status).toBe(200)
    expect(offered.body.suggestion).toMatchObject({
      matcherType: 'merchant_exact',
      matcherValue: 'blue bottle coffee',
      categoryId: coffee,
      categoryName: 'Coffee',
      // The merchant reads the way the bank wrote it, not the way it is compared.
      merchantLabel: 'Blue Bottle Coffee',
      // The second cup is still waiting, and the rule would file it.
      matchingCount: 1,
    })

    const made = await saveRule({ matcherType: 'merchant_exact', matcherValue: 'Blue Bottle Coffee', categoryId: coffee })
    expect(made.body.applied).toBe(1)
    expect((await readSuggestion(cupId)).body.suggestion).toBeNull()
  })

  it('takes the rule away and leaves the charges it filed alone', async () => {
    test.session = owner
    const rule = (await readRules()).body.rules.find(row => row.matcherValue === 'trader joe’s')
    const gone = await dropRule(rule?.id ?? '')

    expect(gone.status).toBe(200)
    expect(gone.body).toEqual({ ruleId: rule?.id })
    expect((await readRules()).body.rules.some(row => row.id === rule?.id)).toBe(false)
    expect((await transactionNamed('TRADER JOES 455'))?.categoryId).toBe(groceries)

    expect((await dropRule(rule?.id ?? '')).status).toBe(404)
  })

  it('keeps the money side to the adults, and answers nothing at all when signed out', async () => {
    const rule = (await readRules()).body.rules[0]

    test.session = member
    expect((await readRules()).status).toBe(403)
    expect((await saveRule({ matcherType: 'merchant_exact', matcherValue: 'Mine', categoryId: groceries })).status).toBe(403)
    expect((await dropRule(rule?.id ?? crypto.randomUUID())).status).toBe(403)

    test.session = null
    expect((await readRules()).status).toBe(401)
  })
})
