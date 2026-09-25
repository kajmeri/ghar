import type { PGlite } from '@electric-sql/pglite'
import type { QuickLogProposal, QuickLogUndo, RequestContext } from '@ghar/contracts'
import { addCalendarDays, todayInTimeZone } from '@ghar/core/dates'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { QUICK_LOG_NOTHING_TO_LOG, QUICK_LOG_UNCLEAR, QUICK_LOG_UNREADABLE } from '@ghar/core/quick-log'
import {
  acceptInvitation,
  createBill,
  createHousehold,
  createInvitation,
  createMaintenanceTask,
  listBillPayments,
  listMaintenanceHistory,
  type Db,
} from '@ghar/db/queries'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { POST as applyRoute } from '@/app/api/v1/quick-log/apply/route'
import { POST as parseRoute } from '@/app/api/v1/quick-log/parse/route'
import { createFakeQuickLogReader, QuickLogError, type QuickLogReader } from '@/lib/providers/quick-log'

// The quick log through /api/v1, against PGlite and the word-matching reader: a sentence becomes
// something to confirm and writes nothing, and confirming records it through the bills and house
// services, with what undoes it.

const test = vi.hoisted(() => ({
  db: undefined as unknown,
  session: null as RequestContext | null,
  reader: undefined as QuickLogReader | undefined,
}))

vi.mock('@/lib/db', () => ({ getDb: () => test.db }))
vi.mock('@/lib/auth/context', async () => {
  const { UnauthorizedError } = await import('@ghar/core/errors')
  const getRequestContext = () =>
    test.session ? Promise.resolve(test.session) : Promise.reject(new UnauthorizedError('Sign in to continue.'))
  return { getRequestContext, getPageContext: getRequestContext }
})
vi.mock('@/lib/providers/quick-log', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/providers/quick-log')>()
  return { ...actual, getQuickLogReader: () => test.reader }
})

let client: PGlite
let db: Db
let owner: RequestContext
let member: RequestContext
let viewer: RequestContext
let waterId: string
let guttersId: string

const today = todayInTimeZone('Europe/London')
/** The water bill falls due three days from now, so a payment yesterday settles it. */
const dueOn = addCalendarDays(today, 3)

function post(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

type ParseReply = { choices?: QuickLogProposal[]; problem?: string | null; error?: { message: string } }
type ApplyReply = { message?: string; undo?: QuickLogUndo; error?: { message: string } }

async function parse(text: string): Promise<{ status: number; body: ParseReply }> {
  const response = await parseRoute(post('/api/v1/quick-log/parse', { text }), { params: Promise.resolve({}) })
  return { status: response.status, body: (await response.json()) as ParseReply }
}

async function apply(body: unknown): Promise<{ status: number; body: ApplyReply }> {
  const response = await applyRoute(post('/api/v1/quick-log/apply', body), { params: Promise.resolve({}) })
  return { status: response.status, body: (await response.json()) as ApplyReply }
}

async function join(email: string, role: 'member' | 'viewer'): Promise<RequestContext> {
  const userId = await createAuthUser(client, email)
  await createInvitation(owner, db, { email, role, tokenHash: `hash-${email}`, expiresAt: invitationExpiresAt(new Date()) })
  await acceptInvitation({ userId, email }, db, { tokenHash: `hash-${email}`, now: new Date() })
  return { userId, householdId: owner.householdId, role }
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  test.db = db
  const ownerId = await createAuthUser(client, 'quick-log-owner@example.com')
  const { household } = await createHousehold({ userId: ownerId, email: 'quick-log-owner@example.com' }, db, {
    name: 'The Rao household',
    timezone: 'Europe/London',
    currency: 'GBP',
  })
  owner = { userId: ownerId, householdId: household.id, role: 'owner' }
  member = await join('quick-log-member@example.com', 'member')
  viewer = await join('quick-log-viewer@example.com', 'viewer')

  waterId = (
    await createBill(owner, db, {
      name: 'Water',
      payee: 'Thames Water',
      amountCents: 4200,
      isVariable: false,
      cadence: 'monthly',
      dueDay: Number(dueOn.slice(8)),
      dueMonth: null,
      autopay: false,
      accountId: null,
      categoryId: null,
      url: null,
      notes: null,
    })
  ).id
  guttersId = (
    await createMaintenanceTask(owner, db, {
      title: 'Clean the gutters',
      assetId: null,
      cadenceMonths: 6,
      cadenceMiles: null,
      lastDoneOn: null,
      nextDueOn: null,
      assignedUserId: null,
      instructions: null,
      vendorContactId: null,
    })
  ).id
})

beforeEach(() => {
  test.reader = createFakeQuickLogReader()
  test.session = owner
})

describe('reading a sentence', () => {
  it('suggests marking a bill paid, and writes nothing', async () => {
    const { status, body } = await parse('Paid the water bill yesterday')
    expect(status).toBe(200)
    expect(body).toEqual({
      choices: [{ action: 'bill_paid', billId: waterId, billName: 'Water', dueOn, paidOn: addCalendarDays(today, -1) }],
      problem: null,
    })
    expect(await listBillPayments(owner, db)).toEqual([])
  })

  it('suggests a house job with its cost', async () => {
    const doneOn = addCalendarDays(today, -2)
    const { body } = await parse(`cleaned the gutters on ${doneOn}, $80`)
    expect(body.choices).toEqual([
      { action: 'task_done', taskId: guttersId, taskTitle: 'Clean the gutters', assetName: null, completedOn: doneOn, costCents: 8000 },
    ])
  })

  it('says why when there’s nothing to suggest', async () => {
    expect((await parse('walked the dog')).body).toEqual({ choices: [], problem: QUICK_LOG_UNCLEAR })

    test.reader = { read: () => Promise.reject(new QuickLogError('Claude couldn’t read the sentence (529).')) }
    expect(await parse('paid the water bill')).toEqual({ status: 200, body: { choices: [], problem: QUICK_LOG_UNREADABLE } })
  })

  it('only offers what the caller could mark themselves', async () => {
    // A member does house jobs but not the bills, so the water bill isn't theirs to find.
    test.session = member
    expect((await parse('paid the water bill')).body.problem).toBe(QUICK_LOG_UNCLEAR)
    expect((await parse('cleaned the gutters')).body.choices).toHaveLength(1)

    test.session = viewer
    expect((await parse('cleaned the gutters')).status).toBe(403)
  })

  it('says to add something first in a household with nothing to log', async () => {
    const userId = await createAuthUser(client, 'quick-log-empty@example.com')
    const { household } = await createHousehold({ userId, email: 'quick-log-empty@example.com' }, db, {
      name: 'An empty household',
      timezone: 'Europe/London',
      currency: 'GBP',
    })
    test.session = { userId, householdId: household.id, role: 'owner' }
    test.reader = { read: () => Promise.reject(new Error('The model should not be asked.')) }
    expect((await parse('paid the rent')).body).toEqual({ choices: [], problem: QUICK_LOG_NOTHING_TO_LOG })
  })
})

describe('confirming', () => {
  it('marks the bill paid once, and says how to take it back', async () => {
    const paidOn = addCalendarDays(today, -1)
    const first = await apply({ action: 'bill_paid', billId: waterId, billName: 'Water', dueOn, paidOn })
    expect(first.status).toBe(200)
    expect(first.body.message).toMatch(/^Marked Water paid for /)
    expect(first.body.undo).toEqual({ action: 'bill_paid', billId: waterId, dueOn })
    expect(await listBillPayments(owner, db)).toMatchObject([{ billId: waterId, dueOn, paidOn }])

    // Again, it would change nothing, and its undo would take back the first mark.
    const again = await apply({ action: 'bill_paid', billId: waterId, dueOn, paidOn })
    expect(again.status).toBe(409)
  })

  it('logs the house job with its cost', async () => {
    const completedOn = addCalendarDays(today, -2)
    const { status, body } = await apply({ action: 'task_done', taskId: guttersId, completedOn, costCents: 8000 })
    expect(status).toBe(200)
    expect(body.message).toMatch(/^Logged Clean the gutters as done on /)
    const log = await listMaintenanceHistory(owner, db, { taskId: guttersId })
    expect(log).toMatchObject([{ id: body.undo?.action === 'task_done' ? body.undo.entryId : '', completedOn, costCents: 8000 }])
  })

  it('refuses a day in the future, a date the bill isn’t due, and what the caller can’t mark', async () => {
    expect((await apply({ action: 'task_done', taskId: guttersId, completedOn: addCalendarDays(today, 1) })).status).toBe(400)
    expect((await apply({ action: 'bill_paid', billId: waterId, dueOn: addCalendarDays(dueOn, 1), paidOn: today })).status).toBe(400)

    test.session = member
    expect((await apply({ action: 'bill_paid', billId: waterId, dueOn, paidOn: today })).status).toBe(403)
  })
})
