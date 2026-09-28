import type { PGlite } from '@electric-sql/pglite'
import { documentStoragePath } from '@ghar/core/documents'
import { ForbiddenError, NotFoundError, ValidationError } from '@ghar/core/errors'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { beforeAll, describe, expect, it } from 'vitest'
import { createContact } from '../src/queries/contacts'
import { createDocument } from '../src/queries/documents'
import {
  getHealthCard,
  listHealthCards,
  saveHealthCard,
  type HealthCardInput,
  claimHealthRefillReminder,
  createHealthMedicine,
  deleteHealthMedicine,
  getHealthMedicine,
  listHealthMedicines,
  listHealthRefillsForReminders,
  refillHealthMedicine,
  releaseHealthRefillReminder,
  stopHealthMedicine,
  updateHealthMedicine,
  type HealthMedicineInput,
  claimHealthReminder,
  createHealthEvent,
  createHealthEvents,
  createHealthSchedule,
  deleteHealthSchedule,
  getHealthSchedule,
  listHealthReminderRecipients,
  listHealthSchedules,
  listHealthSchedulesForReminders,
  releaseHealthReminder,
  updateHealthSchedule,
  type HealthScheduleInput,
  deleteHealthEvent,
  getHealthEvent,
  listHealthEventsPage,
  listHealthPeople,
  updateHealthEvent,
  type HealthEventInput,
} from '../src/queries/health'
import { createInvitation } from '../src/queries/invitations'
import { createPerson, deletePerson, requireOwnPerson } from '../src/queries/people'
import { acceptInvitation, createHousehold } from '../src/queries/session'
import type { Db, RequestContext } from '../src/queries/types'
import { createAuthUser, createTestDatabase, queryAs } from './support/database'

// Health records: owners and adults see and log everyone's, members only their own, viewers only
// look at their own, and nobody outside the household sees any.

const now = new Date()
const today = '2026-09-25'

let client: PGlite
let db: Db
let owner: RequestContext
let adult: RequestContext
let member: RequestContext
let viewer: RequestContext
let outsider: RequestContext
let ownerPerson: string
let memberPerson: string
let viewerPerson: string
let child: string

async function join(householdOwner: RequestContext, email: string, role: 'adult' | 'member' | 'viewer'): Promise<RequestContext> {
  const userId = await createAuthUser(client, email)
  await createInvitation(householdOwner, db, { email, role, tokenHash: `hash-${email}`, expiresAt: invitationExpiresAt(now) })
  await acceptInvitation({ userId, email }, db, { tokenHash: `hash-${email}`, now })
  return { userId, householdId: householdOwner.householdId, role }
}

async function makeHousehold(email: string): Promise<RequestContext> {
  const userId = await createAuthUser(client, email)
  const { household } = await createHousehold({ userId, email }, db, { name: 'Home', timezone: 'Europe/London', currency: 'GBP' })
  return { userId, householdId: household.id, role: 'owner' }
}

function event(personId: string, overrides: Partial<HealthEventInput> = {}): HealthEventInput {
  return {
    personId,
    kind: 'vaccine',
    title: 'Flu shot',
    occurredOn: '2026-09-20',
    contactId: null,
    documentId: null,
    note: null,
    ...overrides,
  }
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  owner = await makeHousehold('health-owner@example.com')
  adult = await join(owner, 'health-adult@example.com', 'adult')
  member = await join(owner, 'health-member@example.com', 'member')
  viewer = await join(owner, 'health-viewer@example.com', 'viewer')
  outsider = await makeHousehold('health-outsider@example.com')
  ownerPerson = await requireOwnPerson(owner, db)
  memberPerson = await requireOwnPerson(member, db)
  viewerPerson = await requireOwnPerson(viewer, db)
  child = (await createPerson(owner, db, { name: 'Asha' }, '2026-09-28')).id
})

describe('logging a record', () => {
  it('tidies the title and note, and names whose it is', async () => {
    const created = await createHealthEvent(owner, db, event(child, { kind: 'dental', title: '  ', note: '  One filling ' }), today)
    expect(created).toMatchObject({ title: 'Dentist', note: 'One filling', personName: 'Asha', personUserId: null, addedBy: owner.userId })
    await deleteHealthEvent(owner, db, created.id)
  })

  it('refuses a date that hasn’t happened, and links from another household', async () => {
    await expect(createHealthEvent(owner, db, event(child, { occurredOn: '2026-09-26' }), today)).rejects.toThrow(ValidationError)
    const theirs = await createContact(outsider, db, {
      name: 'Dr Patel',
      role: null,
      phone: null,
      email: null,
      url: null,
      notes: null,
      tags: [],
    })
    await expect(createHealthEvent(owner, db, event(child, { contactId: theirs.id }), today)).rejects.toThrow(ValidationError)
    await expect(createHealthEvent(outsider, db, event(child), today)).rejects.toThrow(NotFoundError)
  })

  it('links a doctor and a document, and hides a sensitive document’s title from a member', async () => {
    const doctor = await createContact(owner, db, {
      name: 'Dr Rao',
      role: 'GP',
      phone: null,
      email: null,
      url: null,
      notes: null,
      tags: [],
    })
    const card = await createDocument(owner, db, {
      title: 'Vaccine card',
      kind: 'medical',
      issuedOn: null,
      expiresOn: null,
      remindFromDays: null,
      issuer: null,
      referenceNumber: null,
      assetId: null,
      // Someone else's, so the member can't open it. Their own they could.
      personId: child,
      notes: null,
      isSensitive: true,
      storagePath: documentStoragePath(owner.householdId, crypto.randomUUID(), 'application/pdf'),
      mimeType: 'application/pdf',
      sizeBytes: 100,
    })
    const created = await createHealthEvent(owner, db, event(memberPerson, { contactId: doctor.id, documentId: card.id }), today)
    expect(created).toMatchObject({ contactName: 'Dr Rao', documentTitle: 'Vaccine card' })
    expect(await getHealthEvent(member, db, created.id)).toMatchObject({ contactName: 'Dr Rao', documentTitle: null })
    // A member can't link a document they can't see.
    await expect(createHealthEvent(member, db, event(memberPerson, { documentId: card.id }), today)).rejects.toThrow(ValidationError)
    await deleteHealthEvent(owner, db, created.id)
  })

  it('saves what a scan found all together, or none of it', async () => {
    const shots = [
      { kind: 'vaccine' as const, title: 'MMR', occurredOn: '2019-05-02' },
      { kind: 'dental' as const, title: ' ', occurredOn: '2026-03-01' },
    ]
    const saved = await createHealthEvents(owner, db, { personId: child, documentId: null, events: shots }, today)
    expect(saved.map(row => [row.title, row.occurredOn, row.personName, row.note])).toEqual([
      ['MMR', '2019-05-02', 'Asha', null],
      ['Dentist', '2026-03-01', 'Asha', null],
    ])

    const before = (await listHealthEventsPage(owner, db, { personId: child }, { limit: 50 })).rows.length
    const oneBad = [...shots, { kind: 'vaccine' as const, title: 'Flu shot', occurredOn: '2026-09-26' }]
    await expect(createHealthEvents(owner, db, { personId: child, documentId: null, events: oneBad }, today)).rejects.toThrow(
      ValidationError
    )
    await expect(createHealthEvents(owner, db, { personId: child, documentId: null, events: [] }, today)).rejects.toThrow(ValidationError)
    expect((await listHealthEventsPage(owner, db, { personId: child }, { limit: 50 })).rows).toHaveLength(before)

    // The same rules as one record: a member logs only for themselves, a viewer for nobody.
    await expect(createHealthEvents(member, db, { personId: child, documentId: null, events: shots }, today)).rejects.toThrow(NotFoundError)
    await expect(createHealthEvents(viewer, db, { personId: viewerPerson, documentId: null, events: shots }, today)).rejects.toThrow(
      ForbiddenError
    )
    await Promise.all(saved.map(row => deleteHealthEvent(owner, db, row.id)))
  })
})

describe('who sees and logs whose', () => {
  it('lets owners and adults log for anyone, members for themselves, and viewers for nobody', async () => {
    const forChild = await createHealthEvent(adult, db, event(child), today)
    const own = await createHealthEvent(member, db, event(memberPerson, { kind: 'checkup', title: null }), today)
    await expect(createHealthEvent(member, db, event(child), today)).rejects.toThrow(NotFoundError)
    await expect(createHealthEvent(member, db, event(ownerPerson), today)).rejects.toThrow(NotFoundError)
    await expect(createHealthEvent(viewer, db, event(viewerPerson), today)).rejects.toThrow(ForbiddenError)
    const viewersOwn = await createHealthEvent(owner, db, event(viewerPerson), today)

    // A member sees only theirs, and another person's record reads as missing.
    const seenByMember = await listHealthEventsPage(member, db, {}, { limit: 50 })
    expect(seenByMember.rows.map(row => row.id)).toEqual([own.id])
    await expect(getHealthEvent(member, db, forChild.id)).rejects.toThrow(NotFoundError)
    await expect(deleteHealthEvent(member, db, forChild.id)).rejects.toThrow(NotFoundError)

    // A viewer sees their own and can't change it.
    expect((await getHealthEvent(viewer, db, viewersOwn.id)).id).toBe(viewersOwn.id)
    await expect(deleteHealthEvent(viewer, db, viewersOwn.id)).rejects.toThrow(ForbiddenError)

    // A member can't move their own record onto someone else.
    await expect(updateHealthEvent(member, db, own.id, event(child), today)).rejects.toThrow(NotFoundError)

    // The owner sees all three, and nobody outside sees any.
    const all = await listHealthEventsPage(owner, db, {}, { limit: 50 })
    expect(all.rows.map(row => row.id).sort()).toEqual([forChild.id, own.id, viewersOwn.id].sort())
    expect((await listHealthEventsPage(outsider, db, {}, { limit: 50 })).rows).toEqual([])
    await expect(getHealthEvent(outsider, db, own.id)).rejects.toThrow(NotFoundError)

    for (const id of [forChild.id, own.id, viewersOwn.id]) await deleteHealthEvent(owner, db, id)
  })

  it('lists the people each caller may see, with a count and the latest date', async () => {
    const first = await createHealthEvent(owner, db, event(child, { occurredOn: '2025-10-01' }), today)
    const second = await createHealthEvent(owner, db, event(child, { occurredOn: '2026-09-01' }), today)

    const everyone = await listHealthPeople(owner, db)
    expect(everyone).toHaveLength(5)
    expect(everyone.find(person => person.id === child)).toMatchObject({
      name: 'Asha',
      eventCount: 2,
      lastOn: '2026-09-01',
      canManage: true,
    })

    expect(await listHealthPeople(member, db)).toEqual([
      { id: memberPerson, userId: member.userId, name: null, canManage: true, eventCount: 0, lastOn: null },
    ])
    expect((await listHealthPeople(viewer, db)).map(person => [person.id, person.canManage])).toEqual([[viewerPerson, false]])

    await deleteHealthEvent(owner, db, first.id)
    await deleteHealthEvent(owner, db, second.id)
  })

  it('pages newest first, and filters to one person', async () => {
    const dates = ['2024-01-05', '2026-02-10', '2025-06-30']
    const created = []
    for (const occurredOn of dates) created.push(await createHealthEvent(owner, db, event(child, { occurredOn }), today))
    const other = await createHealthEvent(owner, db, event(ownerPerson), today)

    const firstPage = await listHealthEventsPage(owner, db, { personId: child }, { limit: 2 })
    expect(firstPage.rows.map(row => row.occurredOn)).toEqual(['2026-02-10', '2025-06-30'])
    const secondPage = await listHealthEventsPage(owner, db, { personId: child }, { limit: 2, after: firstPage.next })
    expect(secondPage.rows.map(row => row.occurredOn)).toEqual(['2024-01-05'])
    expect(secondPage.next).toBeNull()

    for (const row of [...created, other]) await deleteHealthEvent(owner, db, row.id)
  })
})

describe('the database behind it', () => {
  it('lets the row-level policy show a member only their own records', async () => {
    const own = await createHealthEvent(owner, db, event(memberPerson), today)
    const childs = await createHealthEvent(owner, db, event(child), today)
    const sql = `select id from health_events where id in ('${own.id}', '${childs.id}') order by id`
    expect(await queryAs<{ id: string }>(client, member.userId, sql)).toEqual([{ id: own.id }])
    expect((await queryAs<{ id: string }>(client, adult.userId, sql)).length).toBe(2)
    expect(await queryAs(client, outsider.userId, sql)).toEqual([])
    await deleteHealthEvent(owner, db, own.id)
    await deleteHealthEvent(owner, db, childs.id)
  })

  it('removes a person’s records with them, and audits a deletion without what it said', async () => {
    const baby = (await createPerson(owner, db, { name: 'Ravi' }, '2026-09-28')).id
    const created = await createHealthEvent(owner, db, event(baby, { note: 'Private detail' }), today)
    await deletePerson(owner, db, baby)
    await expect(getHealthEvent(owner, db, created.id)).rejects.toThrow(NotFoundError)

    const logged = await createHealthEvent(owner, db, event(child, { note: 'Private detail' }), today)
    await deleteHealthEvent(owner, db, logged.id)
    const { rows } = await client.query<{ metadata: unknown }>(`select metadata from audit_log where entity_id = '${logged.id}'`)
    expect(JSON.stringify(rows)).not.toContain('Private detail')
    expect(JSON.stringify(rows)).not.toContain('Flu shot')
  })
})

describe('schedules', () => {
  function schedule(personId: string, overrides: Partial<HealthScheduleInput> = {}): HealthScheduleInput {
    return { personId, kind: 'dental', title: null, cadenceMonths: 6, firstDueOn: '2026-01-01', ...overrides }
  }

  it('is due a cadence after the last matching record, and moves when one is logged or deleted', async () => {
    const dentist = await createHealthSchedule(owner, db, schedule(child), today)
    expect(dentist).toMatchObject({ personName: 'Asha', lastOn: null, dueOn: '2026-01-01', state: 'overdue' })

    const visit = await createHealthEvent(owner, db, event(child, { kind: 'dental', title: 'Cleaning', occurredOn: '2026-09-01' }), today)
    // Another kind, or someone else's, doesn't count.
    const other = await createHealthEvent(owner, db, event(ownerPerson, { kind: 'dental', occurredOn: '2026-09-20' }), today)
    expect(await getHealthSchedule(owner, db, dentist.id, today)).toMatchObject({
      lastOn: '2026-09-01',
      dueOn: '2027-03-01',
      state: 'scheduled',
    })

    await deleteHealthEvent(owner, db, visit.id)
    expect((await getHealthSchedule(owner, db, dentist.id, today)).dueOn).toBe('2026-01-01')

    await deleteHealthEvent(owner, db, other.id)
    await deleteHealthSchedule(owner, db, dentist.id, today)
  })

  it('refuses a second schedule for the same thing, whatever the case of its title', async () => {
    const flu = await createHealthSchedule(owner, db, schedule(child, { kind: 'vaccine', title: 'Flu shot', cadenceMonths: 12 }), today)
    await expect(createHealthSchedule(owner, db, schedule(child, { kind: 'vaccine', title: 'flu shot' }), today)).rejects.toThrow(
      ValidationError
    )
    // A different vaccine is its own schedule.
    const tetanus = await createHealthSchedule(owner, db, schedule(child, { kind: 'vaccine', title: 'Tetanus', cadenceMonths: 120 }), today)
    await expect(
      updateHealthSchedule(owner, db, tetanus.id, schedule(child, { kind: 'vaccine', title: 'FLU SHOT' }), today)
    ).rejects.toThrow(ValidationError)
    await deleteHealthSchedule(owner, db, flu.id, today)
    await deleteHealthSchedule(owner, db, tetanus.id, today)
  })

  it('follows who may see and log whose records', async () => {
    const childs = await createHealthSchedule(adult, db, schedule(child), today)
    const own = await createHealthSchedule(member, db, schedule(memberPerson, { kind: 'eye', cadenceMonths: 24 }), today)
    await expect(createHealthSchedule(member, db, schedule(child, { kind: 'eye' }), today)).rejects.toThrow(NotFoundError)
    await expect(createHealthSchedule(viewer, db, schedule(viewerPerson), today)).rejects.toThrow(ForbiddenError)
    const viewers = await createHealthSchedule(owner, db, schedule(viewerPerson), today)

    expect((await listHealthSchedules(member, db, {}, today)).map(row => row.id)).toEqual([own.id])
    await expect(getHealthSchedule(member, db, childs.id, today)).rejects.toThrow(NotFoundError)
    await expect(deleteHealthSchedule(viewer, db, viewers.id, today)).rejects.toThrow(ForbiddenError)
    expect(await listHealthSchedules(outsider, db, {}, today)).toEqual([])
    const sql = `select id from health_schedules where id in ('${own.id}', '${childs.id}')`
    expect(await queryAs<{ id: string }>(client, member.userId, sql)).toEqual([{ id: own.id }])

    for (const row of [childs, viewers]) await deleteHealthSchedule(owner, db, row.id, today)
    await deleteHealthSchedule(member, db, own.id, today)
  })

  it('claims each reminder once per due date, and tells owners, adults and the person only', async () => {
    const own = await createHealthSchedule(owner, db, schedule(memberPerson, { firstDueOn: '2026-10-20' }), today)
    const actor = { householdId: owner.householdId, userId: null }
    const [due] = (await listHealthSchedulesForReminders(actor, db, today)).filter(row => row.id === own.id)
    expect(due).toMatchObject({ dueOn: '2026-10-20', personUserId: member.userId })

    const first = await claimHealthReminder(actor, db, { scheduleId: own.id, dueOn: '2026-10-20', thresholdDays: 30 })
    expect(first).not.toBeNull()
    expect(await claimHealthReminder(actor, db, { scheduleId: own.id, dueOn: '2026-10-20', thresholdDays: 30 })).toBeNull()
    // A closer tier still goes; a further one after a closer never does.
    const closer = await claimHealthReminder(actor, db, { scheduleId: own.id, dueOn: '2026-10-20', thresholdDays: 7 })
    expect(closer).not.toBeNull()
    if (closer !== null) await releaseHealthReminder(actor, db, closer)
    // A new due date starts over.
    expect(await claimHealthReminder(actor, db, { scheduleId: own.id, dueOn: '2027-04-20', thresholdDays: 30 })).not.toBeNull()

    const toMember = await listHealthReminderRecipients(actor, db, member.userId)
    expect(toMember.map(row => row.email).sort()).toEqual([
      'health-adult@example.com',
      'health-member@example.com',
      'health-owner@example.com',
    ])
    const toNobodyElse = await listHealthReminderRecipients(actor, db, null)
    expect(toNobodyElse.map(row => row.email).sort()).toEqual(['health-adult@example.com', 'health-owner@example.com'])

    await deleteHealthSchedule(owner, db, own.id, today)
  })
})

describe('medicines', () => {
  function medicine(personId: string, overrides: Partial<HealthMedicineInput> = {}): HealthMedicineInput {
    return {
      personId,
      name: 'Metformin',
      dose: '500 mg twice a day',
      contactId: null,
      startedOn: '2026-01-10',
      stoppedOn: null,
      refillBy: '2026-10-01',
      supplyDays: 30,
      note: null,
      ...overrides,
    }
  }

  it('keeps a stopped one as history, and refills a current one a supply from today', async () => {
    const doctor = await createContact(owner, db, {
      name: 'Dr Iyer',
      role: 'GP',
      phone: null,
      email: null,
      url: null,
      notes: null,
      tags: [],
    })
    const created = await createHealthMedicine(owner, db, medicine(child, { contactId: doctor.id, name: '  Metformin ' }), today)
    expect(created).toMatchObject({ name: 'Metformin', contactName: 'Dr Iyer', personName: 'Asha', refillBy: '2026-10-01' })

    const refilled = await refillHealthMedicine(owner, db, created.id, today)
    expect(refilled).toMatchObject({ refillBy: '2026-10-25', lastRefilledOn: today })

    const vitamin = await createHealthMedicine(owner, db, medicine(child, { name: 'Vitamin D', refillBy: null, supplyDays: null }), today)
    await expect(refillHealthMedicine(owner, db, vitamin.id, today)).rejects.toThrow(ValidationError)

    const stopped = await stopHealthMedicine(owner, db, created.id, today)
    expect(stopped).toMatchObject({ stoppedOn: today, refillBy: null, name: 'Metformin' })
    await expect(refillHealthMedicine(owner, db, created.id, today)).rejects.toThrow(ValidationError)
    expect((await listHealthMedicines(owner, db, { personId: child })).map(row => row.name)).toEqual(['Vitamin D', 'Metformin'])
    expect((await listHealthMedicines(owner, db, { personId: child, current: true })).map(row => row.name)).toEqual(['Vitamin D'])

    // Clearing the stop date starts it again.
    const restarted = await updateHealthMedicine(owner, db, created.id, medicine(child, { refillBy: null }), today)
    expect(restarted.stoppedOn).toBeNull()

    await deleteHealthMedicine(owner, db, created.id)
    await deleteHealthMedicine(owner, db, vitamin.id)
    await expect(getHealthMedicine(owner, db, created.id)).rejects.toThrow(NotFoundError)
  })

  it('follows who may see and log whose records', async () => {
    const own = await createHealthMedicine(member, db, medicine(memberPerson), today)
    const childs = await createHealthMedicine(owner, db, medicine(child), today)
    await expect(createHealthMedicine(member, db, medicine(child), today)).rejects.toThrow(NotFoundError)
    await expect(createHealthMedicine(viewer, db, medicine(viewerPerson), today)).rejects.toThrow(ForbiddenError)
    await expect(stopHealthMedicine(member, db, childs.id, today)).rejects.toThrow(NotFoundError)
    await expect(getHealthMedicine(outsider, db, own.id)).rejects.toThrow(NotFoundError)
    expect((await listHealthMedicines(member, db, {})).map(row => row.id)).toEqual([own.id])

    const sql = `select id from health_medicines where id in ('${own.id}', '${childs.id}') order by id`
    expect(await queryAs<{ id: string }>(client, member.userId, sql)).toEqual([{ id: own.id }])
    expect((await queryAs<{ id: string }>(client, adult.userId, sql)).length).toBe(2)
    expect(await queryAs(client, outsider.userId, sql)).toEqual([])

    await deleteHealthMedicine(member, db, own.id)
    await deleteHealthMedicine(owner, db, childs.id)
  })

  it('claims each refill reminder once per refill date, and skips stopped ones', async () => {
    const current = await createHealthMedicine(owner, db, medicine(child), today)
    const stopped = await createHealthMedicine(
      owner,
      db,
      medicine(child, { name: 'Amoxicillin', stoppedOn: '2026-09-01', refillBy: null }),
      today
    )
    const actor = { householdId: owner.householdId, userId: null }
    const ids = (await listHealthRefillsForReminders(actor, db)).map(row => row.id)
    expect(ids).toContain(current.id)
    expect(ids).not.toContain(stopped.id)

    const first = await claimHealthRefillReminder(actor, db, { medicineId: current.id, refillBy: '2026-10-01', thresholdDays: 7 })
    expect(first).not.toBeNull()
    expect(await claimHealthRefillReminder(actor, db, { medicineId: current.id, refillBy: '2026-10-01', thresholdDays: 7 })).toBeNull()
    if (first !== null) await releaseHealthRefillReminder(actor, db, first)
    expect(await claimHealthRefillReminder(actor, db, { medicineId: current.id, refillBy: '2026-10-01', thresholdDays: 7 })).not.toBeNull()

    await deleteHealthMedicine(owner, db, current.id)
    await deleteHealthMedicine(owner, db, stopped.id)
  })
})

describe('health cards', () => {
  const blank: HealthCardInput = {
    bloodType: null,
    allergies: [],
    conditions: [],
    doctorContactId: null,
    insuranceDocumentId: null,
    emergencyNote: null,
  }

  it('starts blank, saves and replaces the whole card', async () => {
    const empty = await getHealthCard(owner, db, child)
    expect(empty).toMatchObject({ personName: 'Asha', bloodType: null, allergies: [], updatedAt: null })

    const doctor = await createContact(owner, db, {
      name: 'Dr Mehta',
      role: 'Paediatrician',
      phone: '+1 555 0100',
      email: null,
      url: null,
      notes: null,
      tags: [],
    })
    const saved = await saveHealthCard(owner, db, child, {
      ...blank,
      bloodType: 'O-',
      allergies: ['Peanuts', ' peanuts '],
      conditions: ['Asthma'],
      doctorContactId: doctor.id,
      emergencyNote: ' Inhaler in the front pocket ',
    })
    expect(saved).toMatchObject({
      bloodType: 'O-',
      allergies: ['Peanuts'],
      conditions: ['Asthma'],
      doctorName: 'Dr Mehta',
      doctorPhone: '+1 555 0100',
      emergencyNote: 'Inhaler in the front pocket',
    })
    expect(saved.updatedAt).toBeInstanceOf(Date)

    const replaced = await saveHealthCard(owner, db, child, { ...blank, allergies: ['Penicillin'] })
    expect(replaced).toMatchObject({ bloodType: null, allergies: ['Penicillin'], conditions: [], doctorContactId: null })
  })

  it('follows who may see and edit whose records', async () => {
    await saveHealthCard(member, db, memberPerson, { ...blank, allergies: ['Latex'] })
    await expect(saveHealthCard(member, db, child, blank)).rejects.toThrow(NotFoundError)
    await expect(saveHealthCard(viewer, db, viewerPerson, blank)).rejects.toThrow(ForbiddenError)
    await expect(getHealthCard(outsider, db, memberPerson)).rejects.toThrow(NotFoundError)
    expect((await listHealthCards(member, db, {})).map(card => card.personId)).toEqual([memberPerson])
    // A trip's travellers can include people the caller can't see; they're left out, not refused.
    expect((await listHealthCards(member, db, { personIds: [memberPerson, child] })).map(card => card.personId)).toEqual([memberPerson])
    expect(await listHealthCards(owner, db, { personIds: [] })).toEqual([])

    const sql = `select person_id from health_cards where person_id in ('${memberPerson}', '${child}') order by person_id`
    expect((await queryAs(client, member.userId, sql)).length).toBe(1)
    expect((await queryAs(client, adult.userId, sql)).length).toBe(2)
    expect(await queryAs(client, outsider.userId, sql)).toEqual([])
  })

  it('keeps an insurance card the editor can’t open, but won’t link a new one', async () => {
    const insurance = await createDocument(owner, db, {
      title: 'Insurance card',
      kind: 'medical',
      issuedOn: null,
      expiresOn: null,
      remindFromDays: null,
      issuer: null,
      referenceNumber: null,
      assetId: null,
      // Someone else's, so the member can't open it. Their own they could.
      personId: child,
      notes: null,
      isSensitive: true,
      storagePath: documentStoragePath(owner.householdId, crypto.randomUUID(), 'application/pdf'),
      mimeType: 'application/pdf',
      sizeBytes: 100,
    })
    await saveHealthCard(owner, db, memberPerson, { ...blank, insuranceDocumentId: insurance.id })
    const seen = await getHealthCard(member, db, memberPerson)
    expect(seen).toMatchObject({ insuranceDocumentId: insurance.id, insuranceDocumentTitle: null })

    const kept = await saveHealthCard(member, db, memberPerson, { ...blank, insuranceDocumentId: insurance.id, bloodType: 'A+' })
    expect(kept.insuranceDocumentId).toBe(insurance.id)

    await saveHealthCard(member, db, memberPerson, blank)
    await expect(saveHealthCard(member, db, memberPerson, { ...blank, insuranceDocumentId: insurance.id })).rejects.toThrow(ValidationError)
  })
})
