import type { PGlite } from '@electric-sql/pglite'
import type { Goal, RequestContext } from '@ghar/contracts'
import { invitationExpiresAt } from '@ghar/core/invitations'
import {
  acceptInvitation,
  applyTransactionSync,
  createBankItem,
  createHousehold,
  createInvitation,
  listAccounts,
  type Db,
} from '@ghar/db/queries'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { DELETE as removeGoal, PUT as putGoal } from '@/app/api/v1/finances/goals/[goalId]/route'
import { GET as listGoals, POST as createGoal } from '@/app/api/v1/finances/goals/route'

// /api/v1/finances/goals against PGlite. What a goal has saved is never typed in: it is the
// linked account's balance, so the API is only asked for the target, the date and the link.

const test = vi.hoisted(() => ({ db: undefined as unknown, session: null as RequestContext | null }))

vi.mock('@/lib/db', () => ({ getDb: () => test.db }))
vi.mock('@/lib/auth/context', async () => {
  const { UnauthorizedError } = await import('@ghar/core/errors')
  const getRequestContext = () =>
    test.session ? Promise.resolve(test.session) : Promise.reject(new UnauthorizedError('Sign in to continue.'))
  return { getRequestContext, getPageContext: getRequestContext }
})

const TIME_ZONE = 'America/Chicago'

let client: PGlite
let db: Db
let owner: RequestContext
let adult: RequestContext
let member: RequestContext
/** The synced accounts, by name. */
let accounts: Record<string, string>

interface GoalsBody {
  goals: Goal[]
  totals: { targetCents: number; savedCents: number }
}

async function readGoals(): Promise<{ status: number; body: GoalsBody }> {
  const response = await listGoals(new Request('http://localhost/api/v1/finances/goals'), { params: Promise.resolve({}) })
  return { status: response.status, body: (await response.json()) as GoalsBody }
}

async function addGoal(body: unknown): Promise<{ status: number; body: { goal: Goal } }> {
  const response = await createGoal(
    new Request('http://localhost/api/v1/finances/goals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) }
  )
  return { status: response.status, body: (await response.json()) as { goal: Goal } }
}

async function editGoal(goalId: string, body: unknown): Promise<{ status: number; body: { goal: Goal } }> {
  const response = await putGoal(
    new Request(`http://localhost/api/v1/finances/goals/${goalId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ goalId }) }
  )
  return { status: response.status, body: (await response.json()) as { goal: Goal } }
}

/**
 * The goal by that name. Rows come back oldest first, but the clock is frozen here, so every row
 * is created at the same instant and the list's order is down to the id. Never index into it.
 */
async function goalNamed(name: string): Promise<Goal | undefined> {
  return (await readGoals()).body.goals.find(goal => goal.name === name)
}

async function dropGoal(goalId: string): Promise<{ status: number; body: { goalId: string } }> {
  const response = await removeGoal(new Request(`http://localhost/api/v1/finances/goals/${goalId}`, { method: 'DELETE' }), {
    params: Promise.resolve({ goalId }),
  })
  return { status: response.status, body: (await response.json()) as { goalId: string } }
}

beforeAll(async () => {
  // The household's today, so "a month to have it by" is the same figure every run.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-23T15:00:00Z'))
  ;({ client, db } = await createTestDatabase())
  test.db = db

  const ownerId = await createAuthUser(client, 'goals-owner@example.com')
  const { household } = await createHousehold({ userId: ownerId, email: 'goals-owner@example.com' }, db, {
    name: 'The Rao household',
    timezone: TIME_ZONE,
    currency: 'USD',
  })
  owner = { userId: ownerId, householdId: household.id, role: 'owner' }

  for (const role of ['adult', 'member'] as const) {
    const email = `goals-${role}@example.com`
    const userId = await createAuthUser(client, email)
    const tokenHash = `goals-hash-${role}`
    await createInvitation(owner, db, { email, role, tokenHash, expiresAt: invitationExpiresAt(new Date()) })
    await acceptInvitation({ userId, email }, db, { tokenHash, now: new Date() })
    const joined: RequestContext = { userId, householdId: household.id, role }
    if (role === 'adult') adult = joined
    else member = joined
  }

  const item = await createBankItem(owner, db, {
    environment: 'fake',
    plaidItemId: 'item-goals',
    institutionId: null,
    institutionName: 'Test Bank',
    accessTokenEncrypted: 'v1:test:test:test',
  })
  await applyTransactionSync({ householdId: household.id, userId: null }, db, {
    itemId: item.id,
    expectedCursor: null,
    nextCursor: 'cursor-1',
    now: new Date(),
    accounts: [
      {
        plaidAccountId: 'acct-savings',
        name: 'Savings',
        officialName: null,
        mask: '0002',
        type: 'depository',
        subtype: 'savings',
        currentBalanceCents: 250_000,
        availableBalanceCents: 250_000,
        isoCurrency: 'USD',
      },
      {
        plaidAccountId: 'acct-card',
        name: 'Card',
        officialName: null,
        mask: '0003',
        type: 'credit',
        subtype: 'credit card',
        currentBalanceCents: 40_000,
        availableBalanceCents: null,
        isoCurrency: 'USD',
      },
    ],
    pages: [{ added: [], modified: [], removed: [] }],
  })

  accounts = Object.fromEntries((await listAccounts(owner, db)).map(row => [row.name, row.id]))
  test.session = owner
}, 60_000)

afterAll(() => {
  vi.useRealTimers()
})

describe('keeping goals', () => {
  it('starts with nothing', async () => {
    test.session = owner
    const { status, body } = await readGoals()
    expect(status).toBe(200)
    expect(body.goals).toEqual([])
    expect(body.totals).toEqual({ targetCents: 0, savedCents: 0 })
  })

  it('follows the linked account’s balance, and says what each month asks for', async () => {
    test.session = owner
    const { status, body } = await addGoal({
      name: '  Emergency   fund ',
      targetCents: 1_000_000,
      targetDate: '2026-12-31',
      linkedAccountId: accounts.Savings,
      notes: ' Six months of costs ',
    })

    expect(status).toBe(201)
    expect(body.goal).toMatchObject({
      // The name and the note arrive tidied.
      name: 'Emergency fund',
      notes: 'Six months of costs',
      targetCents: 1_000_000,
      savedCents: 250_000,
      remainingCents: 750_000,
      reached: false,
      overdue: false,
      accountLabel: 'Savings ••0002',
      monthsLeft: 3,
      perMonthCents: 250_000,
    })
    expect(body.goal.fraction).toBeCloseTo(0.25)
  })

  it('counts nothing for a goal with no account behind it', async () => {
    test.session = adult
    const { body } = await addGoal({ name: 'New roof', targetCents: 2_000_000 })
    expect(body.goal).toMatchObject({
      savedCents: null,
      remainingCents: null,
      fraction: 0,
      targetDate: null,
      monthsLeft: null,
      perMonthCents: null,
      accountLabel: null,
    })

    const { body: all } = await readGoals()
    expect(all.goals.map(goal => goal.name).sort()).toEqual(['Emergency fund', 'New roof'])
    expect(all.totals).toEqual({ targetCents: 3_000_000, savedCents: 250_000 })
  })

  it('counts nothing for a card, because a balance owed is not money put aside', async () => {
    test.session = owner
    const { body } = await addGoal({ name: 'Card goal', targetCents: 100_000, linkedAccountId: accounts.Card })
    expect(body.goal).toMatchObject({ savedCents: null, accountLabel: 'Card ••0003' })
    await dropGoal(body.goal.id)
  })

  it('refuses an account that isn’t the household’s, and a target of nothing', async () => {
    test.session = owner
    expect((await addGoal({ name: 'Somewhere else', targetCents: 100_000, linkedAccountId: crypto.randomUUID() })).status).toBe(400)
    expect((await addGoal({ name: 'Nothing', targetCents: 0 })).status).toBe(400)
    expect((await addGoal({ name: '   ', targetCents: 100_000 })).status).toBe(400)
  })

  it('changes a goal, and clears what the new answer leaves out', async () => {
    test.session = owner
    const goal = await goalNamed('Emergency fund')
    const { status, body } = await editGoal(goal?.id ?? '', { name: 'Emergency fund', targetCents: 250_000 })

    expect(status).toBe(200)
    expect(body.goal).toMatchObject({
      targetCents: 250_000,
      targetDate: null,
      notes: null,
      linkedAccountId: null,
      savedCents: null,
      reached: false,
    })
  })

  it('says a goal is reached once the account holds enough', async () => {
    test.session = owner
    const goal = await goalNamed('Emergency fund')
    const { body } = await editGoal(goal?.id ?? '', {
      name: 'Emergency fund',
      targetCents: 200_000,
      linkedAccountId: accounts.Savings,
      targetDate: '2026-11-30',
    })
    expect(body.goal).toMatchObject({ savedCents: 250_000, remainingCents: 0, fraction: 1, reached: true, perMonthCents: null })
  })

  it('calls a goal overdue once its date has gone by without it', async () => {
    test.session = owner
    const { body } = await addGoal({ name: 'Late one', targetCents: 500_000, targetDate: '2026-08-31', linkedAccountId: accounts.Savings })
    expect(body.goal).toMatchObject({ overdue: true, monthsLeft: 0, remainingCents: 250_000, perMonthCents: 250_000 })
    await dropGoal(body.goal.id)
  })

  it('deletes one, and says so only once', async () => {
    test.session = owner
    const goal = await goalNamed('New roof')
    const removed = await dropGoal(goal?.id ?? '')
    expect(removed.status).toBe(200)
    expect(removed.body.goalId).toBe(goal?.id)
    expect((await dropGoal(goal?.id ?? '')).status).toBe(404)
    expect((await readGoals()).body.goals.map(row => row.name)).toEqual(['Emergency fund'])
  })

  it('lets members look but not touch, and answers nothing at all when signed out', async () => {
    test.session = member
    expect((await readGoals()).status).toBe(403)
    expect((await addGoal({ name: 'Mine', targetCents: 100_000 })).status).toBe(403)

    test.session = null
    expect((await readGoals()).status).toBe(401)
  })
})
