import type { PGlite } from '@electric-sql/pglite'
import type { HealthEvent, HealthPerson, RequestContext } from '@ghar/contracts'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { acceptInvitation, createHousehold, createInvitation, createPerson, requireOwnPerson, type Db } from '@ghar/db/queries'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { DELETE as deleteEvent, GET as getEvent, PUT as updateEvent } from '@/app/api/v1/health-records/events/[eventId]/route'
import { GET as listEvents, POST as createEvent } from '@/app/api/v1/health-records/events/route'
import { GET as listPeople } from '@/app/api/v1/health-records/people/route'

// Health records through /api/v1, the way the phone will use them, against PGlite.

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
let viewer: RequestContext
let memberPerson: string
let viewerPerson: string
let child: string

async function join(email: string, role: 'member' | 'viewer'): Promise<RequestContext> {
  const userId = await createAuthUser(client, email)
  await createInvitation(owner, db, { email, role, tokenHash: `hash-${email}`, expiresAt: invitationExpiresAt(new Date()) })
  await acceptInvitation({ userId, email }, db, { tokenHash: `hash-${email}`, now: new Date() })
  return { userId, householdId: owner.householdId, role }
}

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>

async function call(
  handler: Handler,
  method: string,
  { params = {}, body, search = '' }: { params?: Record<string, string>; body?: unknown; search?: string } = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const init: RequestInit =
    body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  const response = await handler(new Request(`http://localhost/api/v1/health-records${search}`, init), { params: Promise.resolve(params) })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  test.db = db
  const ownerId = await createAuthUser(client, 'records-owner@example.com')
  const { household } = await createHousehold({ userId: ownerId, email: 'records-owner@example.com' }, db, {
    name: 'The Mehta household',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
  })
  owner = { userId: ownerId, householdId: household.id, role: 'owner' }
  member = await join('records-member@example.com', 'member')
  viewer = await join('records-viewer@example.com', 'viewer')
  memberPerson = await requireOwnPerson(member, db)
  viewerPerson = await requireOwnPerson(viewer, db)
  child = (await createPerson(owner, db, { name: 'Anika' })).id
})

describe('health records through the API', () => {
  it('logs a record with just whose, what kind and when, and reads it back', async () => {
    test.session = owner
    const created = await call(createEvent, 'POST', { body: { personId: child, kind: 'dental', occurredOn: '2026-03-02' } })
    expect(created.status).toBe(201)
    const event = created.body.event as HealthEvent
    expect(event).toMatchObject({ personName: 'Anika', title: 'Dentist', canEdit: true, note: null })

    const read = await call(getEvent, 'GET', { params: { eventId: event.id } })
    expect((read.body.event as HealthEvent).id).toBe(event.id)

    const updated = await call(updateEvent, 'PUT', {
      params: { eventId: event.id },
      body: { personId: child, kind: 'dental', title: 'Cleaning', occurredOn: '2026-03-02', note: 'All clear' },
    })
    expect(updated.body.event).toMatchObject({ title: 'Cleaning', note: 'All clear' })

    expect((await call(deleteEvent, 'DELETE', { params: { eventId: event.id } })).body).toEqual({ eventId: event.id })
    expect((await call(getEvent, 'GET', { params: { eventId: event.id } })).status).toBe(404)
  })

  it('refuses a date in the future, a kind it doesn’t know, and anyone signed out', async () => {
    test.session = owner
    expect((await call(createEvent, 'POST', { body: { personId: child, kind: 'vaccine', occurredOn: '2999-01-01' } })).status).toBe(400)
    expect((await call(createEvent, 'POST', { body: { personId: child, kind: 'surgery', occurredOn: '2026-01-01' } })).status).toBe(400)
    test.session = null
    expect((await call(listPeople, 'GET')).status).toBe(401)
  })

  it('shows a member only their own, and lets a viewer look but not log', async () => {
    test.session = owner
    const childs = (await call(createEvent, 'POST', { body: { personId: child, kind: 'vaccine', title: 'MMR', occurredOn: '2026-01-10' } }))
      .body.event as HealthEvent
    const viewers = (await call(createEvent, 'POST', { body: { personId: viewerPerson, kind: 'eye', occurredOn: '2026-02-01' } })).body
      .event as HealthEvent

    test.session = member
    const people = (await call(listPeople, 'GET')).body.people as HealthPerson[]
    expect(people).toEqual([{ id: memberPerson, name: 'You', canLog: true, eventCount: 0, lastOn: null }])
    const own = await call(createEvent, 'POST', { body: { personId: memberPerson, kind: 'checkup', occurredOn: '2026-04-01' } })
    expect(own.status).toBe(201)
    expect((await call(createEvent, 'POST', { body: { personId: child, kind: 'checkup', occurredOn: '2026-04-01' } })).status).toBe(404)
    expect((await call(getEvent, 'GET', { params: { eventId: childs.id } })).status).toBe(404)
    const listed = (await call(listEvents, 'GET')).body.items as HealthEvent[]
    expect(listed.map(event => event.title)).toEqual(['Checkup'])
    // Asking for someone else's gives nothing, not an error that says they have records.
    expect((await call(listEvents, 'GET', { search: `?personId=${child}` })).body.items).toEqual([])

    test.session = viewer
    const seen = (await call(getEvent, 'GET', { params: { eventId: viewers.id } })).body.event as HealthEvent
    expect(seen).toMatchObject({ personName: 'You', canEdit: false })
    expect((await call(deleteEvent, 'DELETE', { params: { eventId: viewers.id } })).status).toBe(403)
    expect((await call(createEvent, 'POST', { body: { personId: viewerPerson, kind: 'eye', occurredOn: '2026-02-01' } })).status).toBe(403)

    test.session = owner
    const everyone = (await call(listPeople, 'GET')).body.people as HealthPerson[]
    expect(everyone[0]?.name).toBe('You')
    expect(everyone.find(person => person.id === child)).toMatchObject({ eventCount: 1, lastOn: '2026-01-10', canLog: true })
  })
})
