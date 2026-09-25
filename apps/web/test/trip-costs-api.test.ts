import type { PGlite } from '@electric-sql/pglite'
import type { RequestContext } from '@ghar/contracts'
import { createHousehold, createTrip, updateProfile, type Db } from '@ghar/db/queries'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { POST as respond } from '@/app/api/v1/trip-invites/respond/route'
import { DELETE as deleteCost, PUT as updateCost } from '@/app/api/v1/trips/[tripId]/costs/[costId]/route'
import { GET as listCosts, POST as addCost } from '@/app/api/v1/trips/[tripId]/costs/route'
import { POST as invite } from '@/app/api/v1/trips/[tripId]/guests/route'
import { DELETE as deletePayment } from '@/app/api/v1/trips/[tripId]/payments/[paymentId]/route'
import { POST as pay } from '@/app/api/v1/trips/[tripId]/payments/route'
import type { EmailMessage } from '@/lib/providers/email'

// Shared costs and paying back through /api/v1, against PGlite.

vi.mock('@/lib/env', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  env: () => ({ ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), APP_URL: 'https://ghar.test' }),
}))

interface Account {
  userId: string
  email: string
}

const test = vi.hoisted(() => ({
  db: undefined as unknown,
  account: null as { userId: string; email: string } | null,
  ctx: null as RequestContext | null,
  outbox: [] as EmailMessage[],
}))

vi.mock('@/lib/db', () => ({ getDb: () => test.db }))
vi.mock('@/lib/providers/email', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/providers/email')>()),
  getEmailProvider: () => ({
    send: (message: EmailMessage) => {
      test.outbox.push(message)
      return Promise.resolve({ id: `email-${String(test.outbox.length)}` })
    },
  }),
}))
vi.mock('@/lib/auth/context', async () => {
  const { NotFoundError, UnauthorizedError } = await import('@ghar/core/errors')
  const getSessionContext = () =>
    Promise.resolve(test.account ? { via: 'cookie', ...test.account, tokenHouseholdId: null, token: null } : null)
  const requireSession = async () => {
    const session = await getSessionContext()
    if (!session) throw new UnauthorizedError('Sign in to continue.')
    return session
  }
  const getRequestContext = async () => {
    await requireSession()
    if (!test.ctx) throw new NotFoundError("You haven't created or joined a household yet.")
    return test.ctx
  }
  return { getSessionContext, requireSession, requireAccountSession: requireSession, getRequestContext, getPageContext: getRequestContext }
})

let client: PGlite
let db: Db
let ownerAccount: Account
let owner: RequestContext
let guest: Account
let stranger: Account
let tripId: string

function signInAs(account: Account | null, ctx: RequestContext | null = null) {
  test.account = account
  test.ctx = ctx
}

async function call(
  handler: (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>,
  method: string,
  params: Record<string, string>,
  body?: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  const init: RequestInit =
    body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  const response = await handler(new Request('http://localhost/api/v1/test', init), { params: Promise.resolve(params) })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

interface Party {
  kind: string
  id?: string
}
interface CostsValue {
  currency: string
  you: Party
  parties: { party: Party; name: string | null; heads: number; you: boolean; balanceCents: number }[]
  costs: { id: string; description: string; amountCents: number; yourCents: number; canEdit: boolean }[]
  payments: { id: string; amountCents: number; canDelete: boolean }[]
  transfers: { from: Party; to: Party; amountCents: number; canRecord: boolean }[]
  totalCents: number
  canAdd: boolean
  canPickPayer: boolean
}

const costsOf = (response: { body: Record<string, unknown> }) => response.body.value as CostsValue
const household = { kind: 'household' }
let samParty: Party

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  test.db = db

  ownerAccount = { userId: await createAuthUser(client, 'host@example.com'), email: 'host@example.com' }
  await updateProfile(ownerAccount, db, { fullName: 'Asha Mehta' })
  const { household } = await createHousehold(ownerAccount, db, { name: 'The Mehtas', timezone: 'Europe/Lisbon', currency: 'EUR' })
  owner = { userId: ownerAccount.userId, householdId: household.id, role: 'owner' }

  const trip = await createTrip(owner, db, {
    name: 'Lisbon and Porto',
    destination: 'Lisbon',
    startsOn: '2027-03-12',
    endsOn: '2027-03-15',
    status: 'planned',
    coverImageUrl: null,
    budgetCents: null,
    notes: null,
    travellerIds: [],
  })
  tripId = trip.id

  signInAs(ownerAccount, owner)
  await call(invite, 'POST', { tripId }, { emails: ['sam@example.com'] })
  const token = decodeURIComponent(/\/join\/([^/?\s"]+)/.exec(test.outbox[0]?.text ?? '')?.[1] ?? '')
  guest = { userId: await createAuthUser(client, 'sam@example.com'), email: 'sam@example.com' }
  signInAs(guest)
  await call(respond, 'POST', {}, { token, response: 'going', name: 'Sam Rao', partySize: 2 })

  stranger = { userId: await createAuthUser(client, 'lee@example.com'), email: 'lee@example.com' }
})

describe('shared costs', () => {
  it('are for the people on the trip', async () => {
    signInAs(stranger)
    expect((await call(listCosts, 'GET', { tripId })).status).toBe(404)
    signInAs(null)
    expect((await call(listCosts, 'GET', { tripId })).status).toBe(401)
    signInAs(guest)
    const ledger = costsOf(await call(listCosts, 'GET', { tripId }))
    expect(ledger).toMatchObject({ currency: 'EUR', costs: [], transfers: [], canAdd: true, canPickPayer: false })
    expect(ledger.parties.map(entry => [entry.name, entry.you])).toEqual([
      ['The Mehtas', false],
      ['Sam', true],
    ])
    const sam = ledger.parties.find(entry => entry.you)
    if (!sam) throw new Error('Expected Sam')
    expect(sam.heads).toBe(2)
    samParty = sam.party
    expect(ledger.you).toEqual(samParty)
  })

  it('are added, changed and taken off, with what each owes', async () => {
    signInAs(ownerAccount, owner)
    const dinner = {
      description: 'Dinner at Ramiro',
      amountCents: 300_00,
      spentOn: '2027-03-12',
      paidBy: household,
      shares: [
        { party: household, shares: 1 },
        { party: samParty, shares: 2 },
      ],
    }
    const added = await call(addCost, 'POST', { tripId }, dinner)
    expect(added.status).toBe(201)
    const ledger = costsOf(added)
    expect(ledger.transfers).toEqual([{ from: samParty, to: household, amountCents: 200_00, canRecord: true }])
    const costId = ledger.costs[0]?.id ?? ''

    signInAs(guest)
    expect(costsOf(await call(listCosts, 'GET', { tripId })).costs[0]).toMatchObject({ yourCents: 200_00, canEdit: false })
    expect((await call(addCost, 'POST', { tripId }, dinner)).status).toBe(403)
    expect((await call(updateCost, 'PUT', { tripId, costId }, dinner)).status).toBe(403)
    expect((await call(addCost, 'POST', { tripId }, { ...dinner, paidBy: samParty, amountCents: 12.5 })).status).toBe(400)
    const taxi = await call(addCost, 'POST', { tripId }, { ...dinner, description: 'Taxi', amountCents: 40_00, paidBy: samParty })
    expect(taxi.status).toBe(201)

    signInAs(ownerAccount, owner)
    const changed = costsOf(await call(updateCost, 'PUT', { tripId, costId }, { ...dinner, amountCents: 150_00 }))
    expect(changed.transfers).toEqual([{ from: samParty, to: household, amountCents: 100_00 - 13_33, canRecord: true }])
    expect(changed.totalCents).toBe(190_00)
    const taxiId = changed.costs.find(row => row.description === 'Taxi')?.id ?? ''
    expect(costsOf(await call(deleteCost, 'DELETE', { tripId, costId: taxiId })).costs.map(row => row.description)).toEqual([
      'Dinner at Ramiro',
    ])
    expect((await call(deleteCost, 'DELETE', { tripId, costId: taxiId })).status).toBe(404)
  })

  it('square up when someone pays back', async () => {
    signInAs(guest)
    expect((await call(pay, 'POST', { tripId }, { from: samParty, to: samParty, amountCents: 100, paidOn: '2027-03-16' })).status).toBe(409)
    const paid = await call(pay, 'POST', { tripId }, { from: samParty, to: household, amountCents: 100_00, paidOn: '2027-03-16' })
    expect(paid.status).toBe(201)
    const ledger = costsOf(paid)
    expect(ledger.transfers).toEqual([])
    expect(ledger.parties.map(entry => entry.balanceCents)).toEqual([0, 0])
    const paymentId = ledger.payments[0]?.id ?? ''

    signInAs(stranger)
    expect((await call(deletePayment, 'DELETE', { tripId, paymentId })).status).toBe(404)
    signInAs(ownerAccount, owner)
    expect(costsOf(await call(deletePayment, 'DELETE', { tripId, paymentId })).payments).toEqual([])
  })
})
