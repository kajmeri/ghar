import type { PGlite } from '@electric-sql/pglite'
import type { CalendarDate } from '@ghar/core/dates'
import type { CategorizationPrompt } from '@ghar/core/finances'
import {
  applyTransactionSync,
  createBankItem,
  createCategoryRule,
  createHousehold,
  ensureDefaultCategories,
  listCategories,
  setAccountHidden,
  type Db,
  type RequestContext,
} from '@ghar/db/queries'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { categorizeHousehold, runCategorization, type CategorizationDeps } from '@/lib/finances/run-categorization'
import { CategorizationError, createFakeCategorizer, type TransactionCategorizer } from '@/lib/providers/categorize'

// The categorization waterfall against a real schema: what a household's rules decide, what Plaid's
// categories decide, and what is left for the model. The model here is the stand-in, or a stub when
// a test is about an answer nobody would want a real model to give.

const DATE: CalendarDate = '2026-09-14'

let client: PGlite
let db: Db

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
})

beforeEach(async () => {
  await client.exec('truncate households, plaid_items cascade')
})

let people = 0

/** A household with the default categories it would have been seeded with. */
async function household(): Promise<RequestContext> {
  people += 1
  const email = `owner-${String(people)}@example.com`
  const userId = await createAuthUser(client, email)
  const { household: created } = await createHousehold({ userId, email }, db, {
    name: `Household ${String(people)}`,
    timezone: 'America/New_York',
    currency: 'USD',
  })
  const ctx: RequestContext = { userId, householdId: created.id, role: 'owner' }
  await ensureDefaultCategories(ctx, db)
  return ctx
}

interface Incoming {
  name: string
  merchantName?: string | null
  amountCents?: number
  categoryPrimary?: string | null
  categoryDetailed?: string | null
}

let connections = 0

/** Transactions as a sync brings them in, on one fake connection. Returns each one's id by name. */
async function sync(ctx: RequestContext, incoming: readonly Incoming[]): Promise<Map<string, string>> {
  connections += 1
  const n = String(connections)
  const item = await createBankItem(ctx, db, {
    environment: 'fake',
    plaidItemId: `item-${n}`,
    institutionId: null,
    institutionName: 'Test Bank',
    accessTokenEncrypted: 'v1:test:test:test',
  })
  await applyTransactionSync(ctx, db, {
    itemId: item.id,
    expectedCursor: null,
    nextCursor: `cursor-${n}`,
    now: new Date(),
    accounts: [
      {
        plaidAccountId: `acct-${n}`,
        name: 'Checking',
        officialName: null,
        mask: '0001',
        type: 'depository',
        subtype: 'checking',
        currentBalanceCents: 250_000,
        availableBalanceCents: 250_000,
        isoCurrency: 'USD',
      },
    ],
    pages: [
      {
        added: incoming.map((transaction, index) => ({
          plaidTransactionId: `txn-${n}-${String(index)}`,
          plaidAccountId: `acct-${n}`,
          pendingTransactionId: null,
          isoCurrency: 'USD',
          date: DATE,
          authorizedDate: null,
          paymentChannel: 'in store',
          name: transaction.name,
          merchantName: transaction.merchantName ?? null,
          amountCents: transaction.amountCents ?? -1_000,
          categoryPrimary: transaction.categoryPrimary ?? null,
          categoryDetailed: transaction.categoryDetailed ?? null,
          categoryConfidence: transaction.categoryDetailed === undefined ? null : 'VERY_HIGH',
          isPending: false,
        })),
        modified: [],
        removed: [],
      },
    ],
  })
  const { rows } = await client.query<{ id: string; name: string }>('select id, name from transactions where household_id = $1', [
    ctx.householdId,
  ])
  return new Map(rows.map(row => [row.name, row.id]))
}

interface StoredTransaction {
  category: string | null
  source: string | null
  needsReview: boolean
  suggested: string | null
  confidence: number | null
}

/** What a run stored, read back by the transaction's name with category names rather than ids. */
async function stored(ctx: RequestContext, name: string): Promise<StoredTransaction> {
  const { rows } = await client.query<StoredTransaction>(
    `select c.name as category, t.category_source as source, t.needs_review as "needsReview",
            s.name as suggested, t.category_confidence as confidence
       from transactions t
       left join categories c on c.id = t.category_id
       left join categories s on s.id = t.suggested_category_id
      where t.household_id = $1 and t.name = $2`,
    [ctx.householdId, name]
  )
  const [row] = rows
  if (!row) throw new Error(`No transaction called ${name}`)
  return row
}

async function categoryId(ctx: RequestContext, name: string): Promise<string> {
  const category = (await listCategories(ctx, db)).find(row => row.name === name)
  if (!category) throw new Error(`No category called ${name}`)
  return category.id
}

/** The stand-in, with every prompt it was given. */
function watched(categorizer: TransactionCategorizer = createFakeCategorizer()) {
  const prompts: CategorizationPrompt[] = []
  const deps: CategorizationDeps = {
    db,
    categorizer: () => ({
      categorize(prompt) {
        prompts.push(prompt)
        return categorizer.categorize(prompt)
      },
    }),
  }
  return { deps, prompts }
}

/** The transaction names one prompt carried. */
function asked(prompt: CategorizationPrompt): string[] {
  const listed: unknown = JSON.parse(prompt.user.split('\n')[4] ?? '[]')
  return z
    .array(z.object({ name: z.string() }))
    .parse(listed)
    .map(entry => entry.name)
}

async function categoryName(ctx: RequestContext, id: string | undefined): Promise<string> {
  const category = (await listCategories(ctx, db)).find(row => row.id === id)
  if (!category) throw new Error(`No category with id ${String(id)}`)
  return category.name
}

describe('categorizing a household', () => {
  it('lets a rule beat Plaid’s category, and Plaid’s beat the model', async () => {
    const ctx = await household()
    await createCategoryRule(ctx, db, {
      matcherType: 'merchant_exact',
      matcherValue: 'Blue Bottle',
      categoryId: await categoryId(ctx, 'Coffee'),
    })
    await sync(ctx, [
      // Plaid calls it groceries; the household says its own coffee place is coffee.
      {
        name: 'BLUE BOTTLE 22',
        merchantName: 'Blue Bottle',
        categoryPrimary: 'FOOD_AND_DRINK',
        categoryDetailed: 'FOOD_AND_DRINK_GROCERIES',
      },
      { name: 'SAFEWAY 1042', merchantName: 'Safeway', categoryPrimary: 'FOOD_AND_DRINK', categoryDetailed: 'FOOD_AND_DRINK_GROCERIES' },
      { name: 'TRADER JOES 412', merchantName: 'Trader Joe’s' },
    ])

    const { deps, prompts } = watched()
    expect(await categorizeHousehold(ctx, deps)).toEqual({
      considered: 3,
      byRule: 1,
      byPfc: 1,
      byLlm: 1,
      flagged: 0,
      batches: 1,
      deferred: 0,
    })

    expect(await stored(ctx, 'BLUE BOTTLE 22')).toMatchObject({ category: 'Coffee', source: 'rule', needsReview: false })
    expect(await stored(ctx, 'SAFEWAY 1042')).toMatchObject({ category: 'Groceries', source: 'pfc', needsReview: false })
    expect(await stored(ctx, 'TRADER JOES 412')).toMatchObject({ category: 'Groceries', source: 'llm', needsReview: false })

    // Only what the first two layers couldn't answer was worth asking about.
    expect(prompts).toHaveLength(1)
    expect(prompts[0] && asked(prompts[0])).toEqual(['TRADER JOES 412'])
  })

  it('sends an unconvincing answer, and a missing one, to review', async () => {
    const ctx = await household()
    await sync(ctx, [{ name: 'SQ *UNKNOWN 8812' }, { name: 'POS DEBIT 41221' }])

    // Answers one of them with the first category and little confidence, and says nothing at all
    // about the other.
    const { deps, prompts } = watched({
      categorize: prompt => {
        const ref = `t${String(asked(prompt).indexOf('SQ *UNKNOWN 8812') + 1)}`
        return Promise.resolve({ results: [{ transaction: ref, category: [...prompt.categoryIds.keys()][0], confidence: 0.42 }] })
      },
    })

    expect(await categorizeHousehold(ctx, deps)).toMatchObject({ considered: 2, byLlm: 0, flagged: 2, batches: 1 })
    const guessed = await categoryName(ctx, prompts[0]?.categoryIds.get('c1'))
    expect(await stored(ctx, 'SQ *UNKNOWN 8812')).toEqual({
      category: null,
      source: null,
      needsReview: true,
      suggested: guessed,
      confidence: 42,
    })
    expect(await stored(ctx, 'POS DEBIT 41221')).toEqual({
      category: null,
      source: null,
      needsReview: true,
      suggested: null,
      confidence: null,
    })
  })

  it('leaves a batch the model couldn’t answer for the next run', async () => {
    const ctx = await household()
    await sync(ctx, [{ name: 'TRADER JOES 412', merchantName: 'Trader Joe’s' }])

    const failing = watched({
      categorize: () => Promise.reject(new CategorizationError('Claude couldn’t categorize the batch (503).')),
    })
    expect(await categorizeHousehold(ctx, failing.deps)).toMatchObject({ considered: 1, byLlm: 0, flagged: 0, batches: 0, deferred: 1 })
    // Untouched, not flagged: nobody should have to review a transaction because Anthropic was down.
    expect(await stored(ctx, 'TRADER JOES 412')).toMatchObject({ category: null, source: null, needsReview: false })

    expect(await categorizeHousehold(ctx, watched().deps)).toMatchObject({ byLlm: 1, deferred: 0 })
    expect(await stored(ctx, 'TRADER JOES 412')).toMatchObject({ category: 'Groceries', source: 'llm' })
  })

  it('stops asking after the second failure in a row', async () => {
    const ctx = await household()
    // Three batches' worth, so a run that kept going would ask three times.
    await sync(
      ctx,
      Array.from({ length: 81 }, (_, index) => ({ name: `SQ *UNKNOWN ${String(index)}` }))
    )

    const { deps, prompts } = watched({
      categorize: () => Promise.reject(new CategorizationError('Claude couldn’t categorize the batch (503).')),
    })
    expect(await categorizeHousehold(ctx, deps)).toMatchObject({ considered: 81, batches: 0, flagged: 0, deferred: 81 })
    expect(prompts).toHaveLength(2)
  })

  it('applies the rules after a sync without asking the model', async () => {
    const ctx = await household()
    await sync(ctx, [
      { name: 'SAFEWAY 1042', merchantName: 'Safeway', categoryPrimary: 'FOOD_AND_DRINK', categoryDetailed: 'FOOD_AND_DRINK_GROCERIES' },
      { name: 'SQ *UNKNOWN 8812' },
    ])

    const deps: CategorizationDeps = {
      db,
      categorizer: () => {
        throw new Error('A sync must not reach for the model')
      },
    }
    expect(await categorizeHousehold(ctx, deps, { askModel: false })).toMatchObject({ byPfc: 1, byLlm: 0, batches: 0, deferred: 1 })
    expect(await stored(ctx, 'SAFEWAY 1042')).toMatchObject({ category: 'Groceries', source: 'pfc' })
    expect(await stored(ctx, 'SQ *UNKNOWN 8812')).toMatchObject({ category: null, needsReview: false })
  })

  it('keeps hidden accounts and excluded transactions away from the model', async () => {
    const ctx = await household()
    // Its own connection, so hiding its account hides only it.
    await sync(ctx, [{ name: 'OLD CARD 3311' }])
    const { rows } = await client.query<{ id: string }>('select id from accounts where household_id = $1', [ctx.householdId])
    const [account] = rows
    if (!account) throw new Error('expected the synced account')
    await setAccountHidden(ctx, db, { accountId: account.id, isHidden: true })

    await sync(ctx, [
      { name: 'EXCLUDED CHECK 9', categoryPrimary: 'FOOD_AND_DRINK', categoryDetailed: 'FOOD_AND_DRINK_GROCERIES' },
      { name: 'SQ *UNKNOWN 8812' },
    ])
    await client.query('update transactions set is_excluded = true where household_id = $1 and name = $2', [
      ctx.householdId,
      'EXCLUDED CHECK 9',
    ])

    const { deps, prompts } = watched()
    await categorizeHousehold(ctx, deps)
    // The excluded one still gets Plaid's category; neither it nor the hidden account is worth a
    // model's time, since nobody is going to read those categories.
    expect(await stored(ctx, 'EXCLUDED CHECK 9')).toMatchObject({ category: 'Groceries', source: 'pfc' })
    expect(await stored(ctx, 'OLD CARD 3311')).toMatchObject({ category: null, needsReview: false })
    expect(prompts[0] && asked(prompts[0])).toEqual(['SQ *UNKNOWN 8812'])
  })

  it('runs nightly over the households with something open', async () => {
    const waiting = await household()
    const alsoWaiting = await household()
    const settled = await household()
    await sync(waiting, [{ name: 'TRADER JOES 412', merchantName: 'Trader Joe’s' }])
    await sync(alsoWaiting, [{ name: 'SQ *UNKNOWN 8812' }])
    await sync(settled, [
      { name: 'SAFEWAY 1042', merchantName: 'Safeway', categoryPrimary: 'FOOD_AND_DRINK', categoryDetailed: 'FOOD_AND_DRINK_GROCERIES' },
    ])
    await categorizeHousehold(settled, watched().deps)

    const { deps } = watched()
    expect(await runCategorization(deps)).toEqual({
      households: 2,
      errors: 0,
      considered: 2,
      byRule: 0,
      byPfc: 0,
      byLlm: 1,
      flagged: 1,
      batches: 2,
      deferred: 0,
    })
    expect(await stored(waiting, 'TRADER JOES 412')).toMatchObject({ category: 'Groceries', source: 'llm' })
    expect(await stored(alsoWaiting, 'SQ *UNKNOWN 8812')).toMatchObject({ needsReview: true, suggested: null })
  })
})
