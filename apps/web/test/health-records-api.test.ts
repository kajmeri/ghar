import type { PGlite } from '@electric-sql/pglite'
import type { HealthEvent, HealthMedicine, HealthPerson, HealthSchedule, RequestContext } from '@ghar/contracts'
import { addCalendarDays, todayInTimeZone } from '@ghar/core/dates'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { acceptInvitation, createHousehold, createInvitation, createPerson, requireOwnPerson, type Db } from '@ghar/db/queries'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { DELETE as deleteEvent, GET as getEvent, PUT as updateEvent } from '@/app/api/v1/health-records/events/[eventId]/route'
import { GET as listEvents, POST as createEvent } from '@/app/api/v1/health-records/events/route'
import { POST as refillMedicine } from '@/app/api/v1/health-records/medicines/[medicineId]/refill/route'
import {
  DELETE as deleteMedicine,
  GET as getMedicine,
  PUT as updateMedicine,
} from '@/app/api/v1/health-records/medicines/[medicineId]/route'
import { POST as stopMedicine } from '@/app/api/v1/health-records/medicines/[medicineId]/stop/route'
import { GET as listMedicines, POST as createMedicine } from '@/app/api/v1/health-records/medicines/route'
import { GET as listPeople } from '@/app/api/v1/health-records/people/route'
import { DELETE as deleteSchedule, PUT as updateSchedule } from '@/app/api/v1/health-records/schedules/[scheduleId]/route'
import { GET as listSchedules, POST as createSchedule } from '@/app/api/v1/health-records/schedules/route'

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

  it('keeps a schedule whose next date moves when a visit is logged', async () => {
    test.session = owner
    const created = await call(createSchedule, 'POST', {
      body: { personId: child, kind: 'eye', cadenceMonths: 24, firstDueOn: '2026-01-01' },
    })
    expect(created.status).toBe(201)
    const schedule = created.body.schedule as HealthSchedule
    expect(schedule).toMatchObject({ name: 'Eye test', title: null, lastOn: null, dueOn: '2026-01-01', state: 'overdue', canEdit: true })

    await call(createEvent, 'POST', { body: { personId: child, kind: 'eye', occurredOn: '2026-02-01' } })
    const [moved] = (await call(listSchedules, 'GET', { search: `?personId=${child}` })).body.schedules as HealthSchedule[]
    expect(moved).toMatchObject({ lastOn: '2026-02-01', dueOn: '2028-02-01', state: 'scheduled' })

    // One schedule per person, kind and title.
    const twice = await call(createSchedule, 'POST', {
      body: { personId: child, kind: 'eye', cadenceMonths: 12, firstDueOn: '2026-01-01' },
    })
    expect(twice.status).toBe(400)
    expect(
      await call(createSchedule, 'POST', { body: { personId: child, kind: 'eye', cadenceMonths: 0, firstDueOn: '2026-01-01' } })
    ).toMatchObject({
      status: 400,
    })

    const updated = await call(updateSchedule, 'PUT', {
      params: { scheduleId: schedule.id },
      body: { personId: child, kind: 'eye', cadenceMonths: 12, firstDueOn: '2026-01-01' },
    })
    expect(updated.body.schedule).toMatchObject({ cadenceMonths: 12, dueOn: '2027-02-01' })

    test.session = member
    expect((await call(listSchedules, 'GET')).body.schedules).toEqual([])
    expect((await call(deleteSchedule, 'DELETE', { params: { scheduleId: schedule.id } })).status).toBe(404)

    test.session = viewer
    expect(
      (await call(createSchedule, 'POST', { body: { personId: viewerPerson, kind: 'dental', cadenceMonths: 6, firstDueOn: '2026-10-01' } }))
        .status
    ).toBe(403)

    test.session = owner
    expect((await call(deleteSchedule, 'DELETE', { params: { scheduleId: schedule.id } })).body).toEqual({ scheduleId: schedule.id })
    expect((await call(listSchedules, 'GET')).body.schedules).toEqual([])
  })

  it('keeps medicines, refills them a supply on, and keeps a stopped one as history', async () => {
    test.session = owner
    const today = todayInTimeZone('Asia/Kolkata')
    const created = await call(createMedicine, 'POST', {
      body: { personId: child, name: 'Cetirizine', dose: '5 ml at night', refillBy: addCalendarDays(today, 3), supplyDays: 30 },
    })
    expect(created.status).toBe(201)
    const medicine = created.body.medicine as HealthMedicine
    expect(medicine).toMatchObject({ personName: 'Anika', refillState: 'due_soon', canEdit: true, stoppedOn: null })

    const refilled = await call(refillMedicine, 'POST', { params: { medicineId: medicine.id } })
    expect(refilled.body.medicine).toMatchObject({ refillBy: addCalendarDays(today, 30), lastRefilledOn: today, refillState: 'later' })

    const edited = await call(updateMedicine, 'PUT', {
      params: { medicineId: medicine.id },
      body: { personId: child, name: 'Cetirizine', dose: '10 ml at night', refillBy: null, supplyDays: 30 },
    })
    expect(edited.body.medicine).toMatchObject({ dose: '10 ml at night', refillBy: null, refillState: null })
    expect(
      (
        await call(updateMedicine, 'PUT', {
          params: { medicineId: medicine.id },
          body: { personId: child, name: 'Cetirizine', stoppedOn: addCalendarDays(today, 1) },
        })
      ).status
    ).toBe(400)

    const stopped = await call(stopMedicine, 'POST', { params: { medicineId: medicine.id } })
    expect(stopped.body.medicine).toMatchObject({ stoppedOn: today, refillBy: null })
    expect((await call(refillMedicine, 'POST', { params: { medicineId: medicine.id } })).status).toBe(400)
    expect((await call(listMedicines, 'GET', { search: `?personId=${child}&current=true` })).body.medicines).toEqual([])
    expect(
      ((await call(listMedicines, 'GET', { search: `?personId=${child}` })).body.medicines as HealthMedicine[]).map(row => row.id)
    ).toEqual([medicine.id])

    test.session = member
    expect((await call(getMedicine, 'GET', { params: { medicineId: medicine.id } })).status).toBe(404)
    expect((await call(createMedicine, 'POST', { body: { personId: memberPerson, name: 'Vitamin D' } })).status).toBe(201)

    test.session = viewer
    expect((await call(createMedicine, 'POST', { body: { personId: viewerPerson, name: 'Vitamin D' } })).status).toBe(403)

    test.session = owner
    expect((await call(deleteMedicine, 'DELETE', { params: { medicineId: medicine.id } })).body).toEqual({ medicineId: medicine.id })
    expect((await call(getMedicine, 'GET', { params: { medicineId: medicine.id } })).status).toBe(404)
  })
})
