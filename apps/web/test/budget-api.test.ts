import type { PGlite } from '@electric-sql/pglite'
import type { BudgetHistoryValue, BudgetLine, BudgetMonth, RequestContext } from '@ghar/contracts'
import { invitationExpiresAt } from '@ghar/core/invitations'
import {
  acceptInvitation,
  createHousehold,
  createInvitation,
  createManualTransaction,
  ensureDefaultCategories,
  listCategories,
  type Db,
} from '@ghar/db/queries'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { POST as close } from '@/app/api/v1/finances/budget/close/route'
import { POST as copy } from '@/app/api/v1/finances/budget/copy/route'
import { GET as getHistory } from '@/app/api/v1/finances/budget/history/route'
import { DELETE as removeLine } from '@/app/api/v1/finances/budget/lines/[lineId]/route'
import { PUT as putLine } from '@/app/api/v1/finances/budget/lines/route'
import { GET as getBudget } from '@/app/api/v1/finances/budget/route'
import { PATCH as tag } from '@/app/api/v1/transactions/[transactionId]/route'

// /api/v1/finances/budget against PGlite: what the budget screen reads, what its sheet writes, and
// what closing a month does to the one after it. The month is always the household's own; nothing
// here takes a household id from a request.

const test = vi.hoisted(() => ({ db: undefined as unknown, session: null as RequestContext | null }))

vi.mock('@/lib/db', () => ({ getDb: () => test.db }))
vi.mock('@/lib/auth/context', async () => {
  const { UnauthorizedError } = await import('@ghar/core/errors')
  const getRequestContext = () =>
    test.session ? Promise.resolve(test.session) : Promise.reject(new UnauthorizedError('Sign in to continue.'))
  return { getRequestContext, getPageContext: getRequestContext }
})

const TIME_ZONE = 'America/Chicago'
const SEPTEMBER = '2026-09-01'
const AUGUST = '2026-08-01'

let client: PGlite
let db: Db
let owner: RequestContext
let adult: RequestContext
let member: RequestContext
let groceries: string
let repairs: string

async function readMonth(query: Record<string, string> = {}): Promise<{ status: number; body: BudgetMonth }> {
  const url = new URL('http://localhost/api/v1/finances/budget')
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
  const response = await getBudget(new Request(url), { params: Promise.resolve({}) })
  return { status: response.status, body: (await response.json()) as BudgetMonth }
}

async function planLine(body: unknown): Promise<{ status: number; body: { line: BudgetLine } }> {
  const response = await putLine(
    new Request('http://localhost/api/v1/finances/budget/lines', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) }
  )
  return { status: response.status, body: (await response.json()) as { line: BudgetLine } }
}

async function unplanLine(lineId: string): Promise<{ status: number; body: { lineId: string } }> {
  const response = await removeLine(new Request(`http://localhost/api/v1/finances/budget/lines/${lineId}`, { method: 'DELETE' }), {
    params: Promise.resolve({ lineId }),
  })
  return { status: response.status, body: (await response.json()) as { lineId: string } }
}

async function post(
  handler: typeof copy | typeof close,
  path: string,
  body: unknown
): Promise<{ status: number; body: { copied?: number; budget?: BudgetMonth } }> {
  const response = await handler(
    new Request(`http://localhost/api/v1/finances/budget/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) }
  )
  return { status: response.status, body: (await response.json()) as { copied?: number; budget?: BudgetMonth } }
}

/** A charge typed in by hand, filed under a category the way the sheet files one. */
async function spend(date: string, name: string, amountCents: number, categoryId?: string): Promise<void> {
  const charge = await createManualTransaction(owner, db, { date, name, merchantName: null, amountCents, tripId: null })
  if (!categoryId) return
  await tag(
    new Request(`http://localhost/api/v1/transactions/${charge.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ categoryId }),
    }),
    { params: Promise.resolve({ transactionId: charge.id }) }
  )
}

async function categoryKeyed(systemKey: string): Promise<string> {
  const category = (await listCategories(owner, db)).find(row => row.systemKey === systemKey)
  if (!category) throw new Error(`No ${systemKey} category`)
  return category.id
}

function lineFor(month: BudgetMonth, categoryId: string): BudgetLine | undefined {
  return month.lines.find(line => line.categoryId === categoryId)
}

beforeAll(async () => {
  // The household's today, so which month is current and how much of it has gone by never move.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-22T15:00:00Z'))
  ;({ client, db } = await createTestDatabase())
  test.db = db

  const ownerId = await createAuthUser(client, 'budget-owner@example.com')
  const { household } = await createHousehold({ userId: ownerId, email: 'budget-owner@example.com' }, db, {
    name: 'The Rao household',
    timezone: TIME_ZONE,
    currency: 'USD',
  })
  owner = { userId: ownerId, householdId: household.id, role: 'owner' }
  await ensureDefaultCategories(owner, db)

  for (const role of ['adult', 'member'] as const) {
    const email = `budget-${role}@example.com`
    const userId = await createAuthUser(client, email)
    const tokenHash = `budget-hash-${role}`
    await createInvitation(owner, db, { email, role, tokenHash, expiresAt: invitationExpiresAt(new Date()) })
    await acceptInvitation({ userId, email }, db, { tokenHash, now: new Date() })
    const joined: RequestContext = { userId, householdId: household.id, role }
    if (role === 'adult') adult = joined
    else member = joined
  }

  groceries = await categoryKeyed('groceries')
  repairs = await categoryKeyed('home_maintenance')

  test.session = owner
  await spend('2026-08-10', 'August market', -20_000, groceries)
  await spend('2026-09-05', 'Market run', -12_000, groceries)
  await spend('2026-09-12', 'New tap', -5000, repairs)
  await spend('2026-09-15', 'Odd one', -2000)
}, 60_000)

afterAll(() => {
  vi.useRealTimers()
})

describe('a month nobody has planned', () => {
  it('answers with the household’s current month and what it has spent anyway', async () => {
    test.session = owner
    const { status, body } = await readMonth()

    expect(status).toBe(200)
    expect(body).toMatchObject({ periodStart: SEPTEMBER, today: '2026-09-22', closedAt: null, canClose: false, previousHasLines: false })
    expect(body.lines).toEqual([])
    // Groceries and repairs have no line, and the odd one isn't filed at all.
    expect(body.unbudgetedCents).toBe(17_000)
    expect(body.uncategorizedCents).toBe(2000)
    expect(body.total).toMatchObject({ plannedCents: 0, availableCents: 0, spentCents: 19_000, remainingCents: -19_000 })
    expect(body.elapsedShare).toBeCloseTo(22 / 30)
  })

  it('answers for a month that was asked for, and refuses a date that isn’t a month', async () => {
    test.session = owner
    const august = await readMonth({ periodStart: AUGUST })
    expect(august.body).toMatchObject({ periodStart: AUGUST, unbudgetedCents: 20_000, uncategorizedCents: 0 })
    // August is over, so it is ready to close even before anyone plans it.
    expect(august.body.canClose).toBe(true)
    expect(august.body.elapsedShare).toBe(1)

    expect((await readMonth({ periodStart: '2026-09-15' })).status).toBe(400)
  })

  it('keeps members out, and answers nothing at all when signed out', async () => {
    test.session = member
    expect((await readMonth()).status).toBe(403)
    test.session = null
    expect((await readMonth()).status).toBe(401)
  })
})

describe('planning a category', () => {
  it('returns the line against what the month has already spent', async () => {
    test.session = owner
    const { status, body } = await planLine({ periodStart: SEPTEMBER, categoryId: groceries, plannedCents: 20_000, rolloverEnabled: false })

    expect(status).toBe(200)
    expect(body.line).toMatchObject({
      categoryId: groceries,
      categoryName: 'Groceries',
      plannedCents: 20_000,
      availableCents: 20_000,
      rolloverInCents: 0,
      actualCents: 12_000,
      remainingCents: 8000,
      status: 'under',
      pace: 'under_pace',
    })
  })

  it('moves that spending out of what the plan doesn’t cover', async () => {
    test.session = owner
    const { body } = await readMonth()

    expect(body.lines).toHaveLength(1)
    expect(body.unbudgetedCents).toBe(5000)
    expect(body.uncategorizedCents).toBe(2000)
    expect(body.total).toMatchObject({ plannedCents: 20_000, availableCents: 20_000, spentCents: 19_000, remainingCents: 1000 })
  })

  it('changes the same line rather than adding a second one', async () => {
    test.session = adult
    const { body } = await planLine({ periodStart: SEPTEMBER, categoryId: groceries, plannedCents: 10_000, rolloverEnabled: true })
    expect(body.line).toMatchObject({
      plannedCents: 10_000,
      rolloverEnabled: true,
      actualCents: 12_000,
      remainingCents: -2000,
      status: 'over',
    })

    const month = await readMonth()
    expect(month.body.lines).toHaveLength(1)
  })

  it('is closed to members', async () => {
    test.session = owner
    const line = lineFor((await readMonth()).body, groceries)

    test.session = member
    expect((await planLine({ periodStart: SEPTEMBER, categoryId: repairs, plannedCents: 5000, rolloverEnabled: false })).status).toBe(403)
    expect((await unplanLine(line?.id ?? '')).status).toBe(403)
  })

  it('takes a category back out of the plan without touching what it spent', async () => {
    test.session = owner
    const line = lineFor((await readMonth()).body, groceries)
    const removed = await unplanLine(line?.id ?? '')
    expect(removed.status).toBe(200)
    expect(removed.body.lineId).toBe(line?.id)

    const { body } = await readMonth()
    expect(body.lines).toEqual([])
    expect(body.unbudgetedCents).toBe(17_000)
    expect((await unplanLine(line?.id ?? '')).status).toBe(404)
  })
})

describe('copying a month and closing it', () => {
  it('brings the month before’s lines across', async () => {
    test.session = owner
    await planLine({ periodStart: AUGUST, categoryId: groceries, plannedCents: 30_000, rolloverEnabled: true })

    const copied = await post(copy, 'copy', { periodStart: SEPTEMBER })
    expect(copied.status).toBe(200)
    expect(copied.body.copied).toBe(1)

    const { body } = await readMonth()
    // August is still open, so nothing is carried in yet: only the plan itself comes across.
    expect(lineFor(body, groceries)).toMatchObject({ plannedCents: 30_000, rolloverEnabled: true, rolloverInCents: 0 })
    expect(body.previousHasLines).toBe(true)
  })

  it('has nothing to copy when the month before was never planned', async () => {
    test.session = owner
    expect((await post(copy, 'copy', { periodStart: '2026-01-01' })).status).toBe(404)
  })

  it('refuses to close a month that isn’t over yet', async () => {
    test.session = owner
    expect((await post(close, 'close', { periodStart: SEPTEMBER })).status).toBe(409)
  })

  it('closes a month that has ended and carries what was left into the next one', async () => {
    test.session = owner
    const closed = await post(close, 'close', { periodStart: AUGUST })

    expect(closed.status).toBe(200)
    expect(closed.body.budget).toMatchObject({ periodStart: AUGUST, canClose: false, elapsedShare: 1 })
    expect(closed.body.budget?.closedAt).not.toBeNull()
    expect(lineFor(closed.body.budget as BudgetMonth, groceries)).toMatchObject({ actualCents: 20_000, remainingCents: 10_000 })

    // September's line rolls August's leftover in, so it has 40,000 to spend.
    const september = await readMonth()
    expect(lineFor(september.body, groceries)).toMatchObject({ rolloverInCents: 10_000, availableCents: 40_000, actualCents: 12_000 })
  })

  it('leaves a closed month alone', async () => {
    test.session = owner
    expect((await planLine({ periodStart: AUGUST, categoryId: repairs, plannedCents: 1000, rolloverEnabled: false })).status).toBe(409)
    expect((await post(close, 'close', { periodStart: AUGUST })).status).toBe(409)

    const august = await readMonth({ periodStart: AUGUST })
    expect(august.body.canClose).toBe(false)
    expect(august.body.lines).toHaveLength(1)
  })
})

describe('months against their plans', () => {
  async function readHistory(): Promise<{ status: number; body: BudgetHistoryValue }> {
    const response = await getHistory(new Request('http://localhost/api/v1/finances/budget/history'), { params: Promise.resolve({}) })
    return { status: response.status, body: (await response.json()) as BudgetHistoryValue }
  }

  it('starts at the first month planned, and reads a closed one as it finished', async () => {
    test.session = adult
    const { status, body } = await readHistory()

    expect(status).toBe(200)
    // Nothing was planned before August, so the months before it aren't there to count against.
    expect(body.months.map(month => month.periodStart)).toEqual([AUGUST, SEPTEMBER])
    expect(body.months[0]).toMatchObject({
      planned: true,
      closed: true,
      spentCents: 20_000,
      leftCents: 10_000,
      status: 'within',
      partial: false,
    })
    expect(body.months[1]).toMatchObject({ planned: true, closed: false, spentCents: 19_000, partial: true })
    expect(body).toMatchObject({ withinCount: 1, plannedCount: 1 })
  })

  it('keeps members out, and answers nothing at all when signed out', async () => {
    test.session = member
    expect((await readHistory()).status).toBe(403)
    test.session = null
    expect((await readHistory()).status).toBe(401)
  })
})
