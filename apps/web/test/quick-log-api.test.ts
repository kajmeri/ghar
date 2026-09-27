import type { PGlite } from '@electric-sql/pglite'
import type { QuickLogEntry, QuickLogProposal, QuickLogUndo, RequestContext } from '@ghar/contracts'
import { addCalendarDays, todayInTimeZone } from '@ghar/core/dates'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { QUICK_LOG_UNCLEAR, QUICK_LOG_UNREADABLE } from '@ghar/core/quick-log'
import {
  acceptInvitation,
  createBill,
  createHealthMedicine,
  createHousehold,
  createInvitation,
  createMaintenanceTask,
  createPerson,
  createRenewal,
  getExpiry,
  getHealthEvent,
  getHealthMedicine,
  getTransaction,
  listBillPayments,
  listMaintenanceHistory,
  requireOwnPerson,
  type Db,
} from '@ghar/db/queries'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { POST as undoRenewRoute } from '@/app/api/v1/expiries/[kind]/[subjectId]/renew/undo/route'
import { POST as undoRefillRoute } from '@/app/api/v1/health-records/medicines/[medicineId]/refill/undo/route'
import { POST as applyRoute } from '@/app/api/v1/quick-log/apply/route'
import { POST as parseRoute } from '@/app/api/v1/quick-log/parse/route'
import { DELETE as deleteTransactionRoute } from '@/app/api/v1/transactions/[transactionId]/route'
import { createFakeQuickLogReader, QuickLogError, type QuickLogReader } from '@/lib/providers/quick-log'

// The quick log through /api/v1, against PGlite and the word-matching reader: a sentence becomes
// something to confirm and writes nothing, and confirming records it through the bills, house,
// health, money and renewals services, with what undoes it.

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
let ownerPerson: string
let memberPerson: string
let childPerson: string
let metforminId: string
let insuranceId: string
let gymId: string

const today = todayInTimeZone('Europe/London')
/** The water bill falls due three days from now, so a payment yesterday settles it. */
const dueOn = addCalendarDays(today, 3)
/** When the car insurance and the gym run out now. */
const runsOutOn = addCalendarDays(today, 20)

function post(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

type ParseReply = { entries?: QuickLogEntry[]; problem?: string | null; error?: { message: string } }
/** What a sentence that says one thing comes to. */
type OneReply = { choices?: QuickLogProposal[]; problem?: string | null; error?: { message: string } }
type ApplyReply = { message?: string; undo?: QuickLogUndo; error?: { message: string } }

async function parseAll(text: string): Promise<{ status: number; body: ParseReply }> {
  const response = await parseRoute(post('/api/v1/quick-log/parse', { text }), { params: Promise.resolve({}) })
  return { status: response.status, body: (await response.json()) as ParseReply }
}

/** For a sentence that says one thing: its choices and problem, or why there are none. */
async function parse(text: string): Promise<{ status: number; body: OneReply }> {
  const { status, body } = await parseAll(text)
  if (body.entries === undefined) return { status, body }
  expect(body.entries.length).toBeLessThanOrEqual(1)
  const [entry] = body.entries
  return { status, body: entry ? { choices: entry.choices, problem: entry.problem } : { choices: [], problem: body.problem } }
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

  ownerPerson = await requireOwnPerson(owner, db)
  memberPerson = await requireOwnPerson(member, db)
  childPerson = (await createPerson(owner, db, { name: 'Anika' })).id
  metforminId = (
    await createHealthMedicine(
      owner,
      db,
      {
        personId: ownerPerson,
        name: 'Metformin',
        dose: null,
        contactId: null,
        startedOn: null,
        stoppedOn: null,
        refillBy: null,
        supplyDays: 30,
        note: null,
      },
      today
    )
  ).id

  const renewal = {
    kind: 'policy' as const,
    expiresOn: runsOutOn,
    cadenceMonths: 12,
    autoRenews: false,
    costCents: null,
    provider: null,
    referenceNumber: null,
    url: null,
    contactId: null,
    assetId: null,
    documentId: null,
    personId: null,
    notes: null,
  }
  insuranceId = (await createRenewal(owner, db, { ...renewal, title: 'Car insurance' })).id
  gymId = (await createRenewal(owner, db, { ...renewal, title: 'Gym membership', kind: 'membership' })).id
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

  it('logs a visit for yourself even in a new household with nothing else in it', async () => {
    const userId = await createAuthUser(client, 'quick-log-empty@example.com')
    const { household } = await createHousehold({ userId, email: 'quick-log-empty@example.com' }, db, {
      name: 'An empty household',
      timezone: 'Europe/London',
      currency: 'GBP',
    })
    test.session = { userId, householdId: household.id, role: 'owner' }
    expect((await parse('paid the rent')).body).toEqual({ choices: [], problem: QUICK_LOG_UNCLEAR })
    expect((await parse('went to the dentist')).body.choices).toMatchObject([{ action: 'health_event', personName: 'You', kind: 'dental' }])
  })

  it('suggests a shot for whoever it was, and a medicine refill', async () => {
    expect((await parse('Anika had her flu jab yesterday')).body.choices).toEqual([
      {
        action: 'health_event',
        personId: childPerson,
        personName: 'Anika',
        kind: 'vaccine',
        title: null,
        occurredOn: addCalendarDays(today, -1),
      },
    ])
    expect((await parse('refilled the metformin')).body.choices).toEqual([
      { action: 'medicine_refilled', medicineId: metforminId, medicineName: 'Metformin', personName: 'You', refilledOn: today },
    ])

    // A member logs only their own: no one else's medicine, and a checkup is theirs.
    test.session = member
    expect((await parse('refilled the metformin')).body.problem).toBe(QUICK_LOG_UNCLEAR)
    expect((await parse('went for a checkup')).body.choices).toMatchObject([{ personId: memberPerson, personName: 'You' }])
  })
})

describe('reading money and renewals', () => {
  it('suggests cash spending with a category, for someone who can log spending', async () => {
    expect((await parse('£12 cash on groceries yesterday')).body.choices).toMatchObject([
      {
        action: 'cash_spent',
        description: 'Groceries',
        merchant: null,
        amountCents: 1200,
        spentOn: addCalendarDays(today, -1),
        categoryName: 'Groceries',
      },
    ])
    expect((await parse('spent some cash')).body.problem).toMatch(/how much/)

    test.session = member
    expect((await parse('spent £5 cash')).body.problem).toBe('Only owners and adults can log spending.')
  })

  it('suggests a renewal with the date said, or asks, and not renewing', async () => {
    const until = addCalendarDays(runsOutOn, 365)
    expect((await parse(`renewed the car insurance until ${until}`)).body.choices).toEqual([
      {
        action: 'renewed',
        kind: 'renewal',
        subjectId: insuranceId,
        name: 'Car insurance',
        currentExpiresOn: runsOutOn,
        expiresOn: until,
        suggestedRenewalOn: expect.any(String) as string,
      },
    ])
    expect((await parse('renewed the car insurance')).body.choices).toMatchObject([{ expiresOn: null }])
    expect((await parse('not renewing the gym membership')).body.choices).toEqual([
      { action: 'not_renewing', kind: 'renewal', subjectId: gymId, name: 'Gym membership', expiresOn: runsOutOn },
    ])
  })
})

describe('reading several things at once', () => {
  it('suggests each in order, says which can’t be logged, and writes nothing', async () => {
    const { status, body } = await parseAll('paid the water bill yesterday and cleaned the gutters; went for a walk')
    expect(status).toBe(200)
    expect(body).toEqual({
      entries: [
        {
          said: 'paid the water bill yesterday',
          choices: [{ action: 'bill_paid', billId: waterId, billName: 'Water', dueOn, paidOn: addCalendarDays(today, -1) }],
          problem: null,
        },
        {
          said: 'cleaned the gutters',
          choices: [
            {
              action: 'task_done',
              taskId: guttersId,
              taskTitle: 'Clean the gutters',
              assetName: null,
              completedOn: today,
              costCents: null,
            },
          ],
          problem: null,
        },
        { said: 'went for a walk', choices: [], problem: QUICK_LOG_UNCLEAR },
      ],
      problem: null,
    })
    expect(await listBillPayments(owner, db)).toEqual([])
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

  it('adds a visit or shot to their record', async () => {
    const occurredOn = addCalendarDays(today, -1)
    const { status, body } = await apply({ action: 'health_event', personId: childPerson, kind: 'vaccine', title: 'Flu shot', occurredOn })
    expect(status).toBe(200)
    expect(body.message).toMatch(/^Added Flu shot for Anika on /)
    const eventId = body.undo?.action === 'health_event' ? body.undo.eventId : ''
    expect(await getHealthEvent(owner, db, eventId)).toMatchObject({
      personId: childPerson,
      kind: 'vaccine',
      title: 'Flu shot',
      occurredOn,
    })

    test.session = member
    expect((await apply({ action: 'health_event', personId: childPerson, kind: 'dental', occurredOn })).status).toBe(404)
  })

  it('marks a medicine refilled once, and takes it back only while nothing has changed since', async () => {
    const refilledOn = addCalendarDays(today, -2)
    const first = await apply({ action: 'medicine_refilled', medicineId: metforminId, refilledOn })
    expect(first.status).toBe(200)
    expect(first.body.message).toMatch(/^Marked Metformin refilled on .+\. Next refill by .+\.$/)
    expect(first.body.undo).toEqual({
      action: 'medicine_refilled',
      medicineId: metforminId,
      refilledOn,
      previousRefillBy: null,
      previousLastRefilledOn: null,
    })
    expect(await getHealthMedicine(owner, db, metforminId)).toMatchObject({
      lastRefilledOn: refilledOn,
      refillBy: addCalendarDays(refilledOn, 30),
    })

    expect((await apply({ action: 'medicine_refilled', medicineId: metforminId, refilledOn })).status).toBe(409)
    expect((await apply({ action: 'medicine_refilled', medicineId: metforminId, refilledOn: addCalendarDays(today, -3) })).status).toBe(400)
    expect((await apply({ action: 'medicine_refilled', medicineId: metforminId, refilledOn: addCalendarDays(today, 1) })).status).toBe(400)

    const { medicineId, ...undoBody } = first.body.undo?.action === 'medicine_refilled' ? first.body.undo : { medicineId: '' }
    const undo = () =>
      undoRefillRoute(post(`/api/v1/health-records/medicines/${medicineId}/refill/undo`, undoBody), {
        params: Promise.resolve({ medicineId }),
      })
    expect((await undo()).status).toBe(200)
    expect(await getHealthMedicine(owner, db, metforminId)).toMatchObject({ lastRefilledOn: null, refillBy: null })
    // Taken back already, so there's nothing of it left to take back.
    expect((await undo()).status).toBe(409)
  })

  it('adds cash spending, filed, and deletes it again on undo', async () => {
    const spentOn = addCalendarDays(today, -1)
    const [groceries] = (await parse('£12 cash on groceries')).body.choices ?? []
    const categoryId = groceries?.action === 'cash_spent' ? groceries.categoryId : null
    const { status, body } = await apply({ action: 'cash_spent', description: 'Groceries', amountCents: 1200, spentOn, categoryId })
    expect(status).toBe(200)
    expect(body.message).toMatch(/^Added Groceries for £12\.00 on .+\. Filed under Groceries\.$/)
    const transactionId = body.undo?.action === 'cash_spent' ? body.undo.transactionId : ''
    expect(await getTransaction(owner, db, { transactionId })).toMatchObject({
      amountCents: -1200,
      date: spentOn,
      accountId: null,
      categoryId,
      categorySource: 'user',
    })

    const undo = () =>
      deleteTransactionRoute(new Request(`http://localhost/api/v1/transactions/${transactionId}`, { method: 'DELETE' }), {
        params: Promise.resolve({ transactionId }),
      })
    expect((await undo()).status).toBe(200)
    expect((await undo()).status).toBe(404)

    expect((await apply({ action: 'cash_spent', description: 'Lunch', amountCents: 800, spentOn: addCalendarDays(today, 1) })).status).toBe(
      400
    )
    test.session = member
    expect((await apply({ action: 'cash_spent', description: 'Lunch', amountCents: 800, spentOn })).status).toBe(403)
  })

  it('renews to a later date, and takes it back only while the date is still the renewed one', async () => {
    const subject = { kind: 'renewal' as const, id: insuranceId }
    expect((await apply({ action: 'renewed', kind: 'renewal', subjectId: insuranceId, expiresOn: runsOutOn })).status).toBe(400)

    const renewedTo = addCalendarDays(runsOutOn, 365)
    const { status, body } = await apply({ action: 'renewed', kind: 'renewal', subjectId: insuranceId, expiresOn: renewedTo })
    expect(status).toBe(200)
    expect(body.message).toMatch(/^Renewed Car insurance to /)
    expect(body.undo).toEqual({
      action: 'renewed',
      kind: 'renewal',
      subjectId: insuranceId,
      renewedTo,
      previousExpiresOn: runsOutOn,
      previousIssuedOn: null,
    })
    expect(await getExpiry(owner, db, subject)).toMatchObject({ expiresOn: renewedTo })

    const undoBody = { renewedTo, previousExpiresOn: runsOutOn }
    const undo = () =>
      undoRenewRoute(post(`/api/v1/expiries/renewal/${insuranceId}/renew/undo`, undoBody), {
        params: Promise.resolve({ kind: 'renewal', subjectId: insuranceId }),
      })
    expect((await undo()).status).toBe(200)
    expect(await getExpiry(owner, db, subject)).toMatchObject({ expiresOn: runsOutOn })
    // Its date isn't the renewed one any more, so there's nothing of it left to take back.
    expect((await undo()).status).toBe(409)
  })

  it('stops reminders for something not being renewed, once', async () => {
    const body = { action: 'not_renewing', kind: 'renewal', subjectId: gymId, expiresOn: runsOutOn }
    const first = await apply(body)
    expect(first.status).toBe(200)
    expect(first.body.message).toBe('Noted you’re not renewing Gym membership. Its reminders have stopped.')
    expect(first.body.undo).toEqual({ action: 'not_renewing', kind: 'renewal', subjectId: gymId })
    expect(await getExpiry(owner, db, { kind: 'renewal', id: gymId })).toMatchObject({ notRenewing: true })
    expect((await apply(body)).status).toBe(409)
    expect((await parse('not renewing the gym membership')).body.problem).toBe('Gym membership is already marked as not being renewed.')
  })

  it('refuses a day in the future, a date the bill isn’t due, and what the caller can’t mark', async () => {
    expect((await apply({ action: 'task_done', taskId: guttersId, completedOn: addCalendarDays(today, 1) })).status).toBe(400)
    expect((await apply({ action: 'bill_paid', billId: waterId, dueOn: addCalendarDays(dueOn, 1), paidOn: today })).status).toBe(400)

    test.session = member
    expect((await apply({ action: 'bill_paid', billId: waterId, dueOn, paidOn: today })).status).toBe(403)
  })
})
