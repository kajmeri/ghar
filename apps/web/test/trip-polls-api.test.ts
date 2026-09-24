import type { PGlite } from '@electric-sql/pglite'
import type { RequestContext } from '@ghar/contracts'
import { invitationExpiresAt } from '@ghar/core/invitations'
import {
  acceptInvitation,
  createHousehold,
  createInvitation,
  createOption,
  createSlot,
  createTrip,
  getTripWithCounts,
  type Db,
} from '@ghar/db/queries'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { POST as respond } from '@/app/api/v1/trip-invites/respond/route'
import { DELETE as deleteShared } from '@/app/api/v1/shared-trips/[tripId]/options/[optionId]/route'
import { PUT as voteShared } from '@/app/api/v1/shared-trips/[tripId]/options/[optionId]/vote/route'
import { POST as suggestShared } from '@/app/api/v1/shared-trips/[tripId]/slots/[slotId]/options/route'
import { POST as invite } from '@/app/api/v1/trips/[tripId]/guests/route'
import { DELETE as deletePoll, PATCH as patchPoll } from '@/app/api/v1/trips/[tripId]/polls/[pollId]/route'
import { POST as addOption } from '@/app/api/v1/trips/[tripId]/polls/[pollId]/options/route'
import { DELETE as deleteOption } from '@/app/api/v1/trips/[tripId]/polls/[pollId]/options/[optionId]/route'
import { POST as pick } from '@/app/api/v1/trips/[tripId]/polls/[pollId]/options/[optionId]/pick/route'
import { PUT as vote } from '@/app/api/v1/trips/[tripId]/polls/[pollId]/options/[optionId]/vote/route'
import { GET as listPolls, POST as openPoll } from '@/app/api/v1/trips/[tripId]/polls/route'
import type { EmailMessage } from '@/lib/providers/email'

// Polls and a guest's say on the plan through /api/v1, against PGlite: the household opens and
// picks, guests add options and vote, and nobody else gets in.

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
vi.mock('@/lib/providers/email', () => ({
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
let viewerAccount: Account
let viewer: RequestContext
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

interface PollOption {
  id: string
  startsOn: string | null
  label: string | null
  addedBy: string | null
  canDelete: boolean
  yes: number
  no: number
  myVote: string | null
}
interface Poll {
  id: string
  kind: string
  decideBy: string | null
  options: PollOption[]
  leaderId: string | null
}
interface PollsValue {
  polls: Poll[]
  canVote: boolean
  canManage: boolean
}

const valueOf = (response: { body: Record<string, unknown> }) => response.body.value as PollsValue
const pollOf = (response: { body: Record<string, unknown> }, kind: string): Poll => {
  const poll = valueOf(response).polls.find(each => each.kind === kind)
  if (!poll) throw new Error(`No ${kind} poll`)
  return poll
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  test.db = db
  const now = new Date()

  ownerAccount = { userId: await createAuthUser(client, 'host@example.com'), email: 'host@example.com' }
  const { household } = await createHousehold(ownerAccount, db, { name: 'The Mehtas', timezone: 'UTC', currency: 'USD' })
  owner = { userId: ownerAccount.userId, householdId: household.id, role: 'owner' }

  viewerAccount = { userId: await createAuthUser(client, 'gran@example.com'), email: 'gran@example.com' }
  await createInvitation(owner, db, {
    email: viewerAccount.email,
    role: 'viewer',
    tokenHash: 'hash-gran',
    expiresAt: invitationExpiresAt(now),
  })
  await acceptInvitation(viewerAccount, db, { tokenHash: 'hash-gran', now })
  viewer = { userId: viewerAccount.userId, householdId: household.id, role: 'viewer' }

  const trip = await createTrip(owner, db, {
    name: 'Somewhere in spring',
    destination: null,
    startsOn: null,
    endsOn: null,
    status: 'idea',
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
  await call(respond, 'POST', {}, { token, response: 'going', name: 'Sam Rao' })

  stranger = { userId: await createAuthUser(client, 'lee@example.com'), email: 'lee@example.com' }
})

afterEach(() => {
  signInAs(null)
})

describe('polls over the API', () => {
  let pollId: string

  it('is opened by the household only, once per kind', async () => {
    signInAs(guest)
    expect((await call(openPoll, 'POST', { tripId }, { kind: 'dates' })).status).toBe(403)
    signInAs(viewerAccount, viewer)
    expect((await call(openPoll, 'POST', { tripId }, { kind: 'dates' })).status).toBe(403)

    signInAs(ownerAccount, owner)
    expect((await call(openPoll, 'POST', { tripId }, { kind: 'someday' })).status).toBe(400)
    const opened = await call(openPoll, 'POST', { tripId }, { kind: 'dates', decideBy: '2027-01-15' })
    expect(opened.status).toBe(201)
    expect(valueOf(opened)).toMatchObject({ canVote: true, canManage: true })
    pollId = pollOf(opened, 'dates').id
    expect((await call(openPoll, 'POST', { tripId }, { kind: 'dates' })).status).toBe(409)
  })

  it('shows to the household and guests, and to nobody else', async () => {
    signInAs(guest)
    const seen = await call(listPolls, 'GET', { tripId })
    expect(seen.status).toBe(200)
    expect(valueOf(seen)).toMatchObject({ canVote: true, canManage: false, polls: [{ kind: 'dates', title: 'When works?' }] })

    signInAs(viewerAccount, viewer)
    expect(valueOf(await call(listPolls, 'GET', { tripId }))).toMatchObject({ canVote: false, canManage: false })

    signInAs(stranger)
    expect((await call(listPolls, 'GET', { tripId })).status).toBe(404)
    signInAs(null)
    expect((await call(listPolls, 'GET', { tripId })).status).toBe(401)
  })

  it('takes options and votes from a guest, and counts them', async () => {
    signInAs(guest)
    const added = await call(addOption, 'POST', { tripId, pollId }, { startsOn: '2027-03-12', endsOn: '2027-03-15' })
    expect(added.status).toBe(201)
    expect((await call(addOption, 'POST', { tripId, pollId }, { startsOn: '2027-03-12', endsOn: '2027-03-15' })).status).toBe(409)
    expect((await call(addOption, 'POST', { tripId, pollId }, { startsOn: '2020-03-12', endsOn: '2020-03-15' })).status).toBe(400)
    expect((await call(addOption, 'POST', { tripId, pollId }, { label: 'Lisbon' })).status).toBe(400)
    const option = pollOf(added, 'dates').options[0]
    expect(option).toMatchObject({ startsOn: '2027-03-12', addedBy: 'Sam', canDelete: true })
    const optionId = option?.id ?? ''

    const voted = await call(vote, 'PUT', { tripId, pollId, optionId }, { vote: 'yes' })
    expect(pollOf(voted, 'dates')).toMatchObject({ leaderId: optionId, options: [{ yes: 1, myVote: 'yes' }] })

    signInAs(viewerAccount, viewer)
    expect((await call(vote, 'PUT', { tripId, pollId, optionId }, { vote: 'no' })).status).toBe(403)

    signInAs(ownerAccount, owner)
    const theirs = await call(listPolls, 'GET', { tripId })
    expect(pollOf(theirs, 'dates').options[0]).toMatchObject({ yes: 1, myVote: null, canDelete: true })
    expect((await call(patchPoll, 'PATCH', { tripId, pollId }, { decideBy: '2020-01-01' })).status).toBe(400)
    expect(pollOf(await call(patchPoll, 'PATCH', { tripId, pollId }, { decideBy: null }), 'dates').decideBy).toBeNull()
  })

  it('lets a guest take back only their own option', async () => {
    signInAs(ownerAccount, owner)
    const mine = pollOf(await call(addOption, 'POST', { tripId, pollId }, { startsOn: '2027-04-02', endsOn: '2027-04-05' }), 'dates')
    const hostOption = mine.options.find(option => option.startsOn === '2027-04-02')

    signInAs(guest)
    expect(pollOf(await call(listPolls, 'GET', { tripId }), 'dates').options.find(o => o.id === hostOption?.id)).toMatchObject({
      canDelete: false,
    })
    expect((await call(deleteOption, 'DELETE', { tripId, pollId, optionId: hostOption?.id ?? '' })).status).toBe(403)
    expect((await call(pick, 'POST', { tripId, pollId, optionId: hostOption?.id ?? '' })).status).toBe(403)
  })

  it('makes the pick the trip’s dates, and closes the poll', async () => {
    signInAs(ownerAccount, owner)
    const before = pollOf(await call(listPolls, 'GET', { tripId }), 'dates')
    const leader = before.options.find(option => option.id === before.leaderId)
    const picked = await call(pick, 'POST', { tripId, pollId, optionId: leader?.id ?? '' })
    expect(picked.status).toBe(200)
    expect(valueOf(picked).polls).toEqual([])
    expect(await getTripWithCounts(owner, db, tripId)).toMatchObject({ startsOn: '2027-03-12', endsOn: '2027-03-15' })
    expect((await call(deletePoll, 'DELETE', { tripId, pollId })).status).toBe(404)
  })

  it('closes a place poll without picking', async () => {
    signInAs(ownerAccount, owner)
    const place = pollOf(await call(openPoll, 'POST', { tripId }, { kind: 'place' }), 'place')
    signInAs(guest)
    const added = await call(addOption, 'POST', { tripId, pollId: place.id }, { label: '  Lisbon   and Porto ' })
    expect(pollOf(added, 'place').options[0]).toMatchObject({ label: 'Lisbon and Porto' })
    expect((await call(deletePoll, 'DELETE', { tripId, pollId: place.id })).status).toBe(403)

    signInAs(ownerAccount, owner)
    expect(valueOf(await call(deletePoll, 'DELETE', { tripId, pollId: place.id })).polls).toEqual([])
  })
})

describe('a guest on what’s being decided', () => {
  let slotId: string
  let hostOptionId: string

  beforeAll(async () => {
    const dinner = await createSlot(owner, db, tripId, {
      day: '2027-03-13',
      band: 'evening',
      kind: 'meal',
      label: 'Dinner',
      startsAt: null,
      endsAt: null,
      decideBy: null,
      notes: null,
    })
    slotId = dinner.id
    hostOptionId =
      (await createOption(owner, db, tripId, dinner.id, { title: 'Cervejaria Ramiro', costCents: 12_000 })).options[0]?.id ?? ''
  })

  it('votes, suggests, and takes back only their own suggestion', async () => {
    signInAs(guest)
    const voted = await call(voteShared, 'PUT', { tripId, optionId: hostOptionId }, { vote: 'yes' })
    expect(voted.status).toBe(200)
    expect(JSON.stringify(voted.body)).not.toContain('12000')

    const suggested = await call(suggestShared, 'POST', { tripId, slotId }, { title: 'Taberna da Rua das Flores' })
    expect(suggested.status).toBe(201)
    const trip = suggested.body.trip as {
      itinerary: { slots: { choices: { id: string; title: string; mine: boolean; myVote: string | null }[] }[] }[]
    }
    const choices = trip.itinerary[0]?.slots[0]?.choices ?? []
    expect(choices.map(choice => [choice.title, choice.mine, choice.myVote])).toEqual([
      ['Cervejaria Ramiro', false, 'yes'],
      ['Taberna da Rua das Flores', true, null],
    ])

    expect((await call(deleteShared, 'DELETE', { tripId, optionId: hostOptionId })).status).toBe(403)
    const mine = choices.find(choice => choice.mine)
    expect((await call(deleteShared, 'DELETE', { tripId, optionId: mine?.id ?? '' })).status).toBe(200)
  })

  it('keeps the household and strangers out', async () => {
    signInAs(ownerAccount, owner)
    expect((await call(voteShared, 'PUT', { tripId, optionId: hostOptionId }, { vote: 'yes' })).status).toBe(404)
    signInAs(stranger)
    expect((await call(suggestShared, 'POST', { tripId, slotId }, { title: 'Somewhere' })).status).toBe(404)
  })
})
