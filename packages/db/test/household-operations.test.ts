import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { billDueDates, matchBillPayments } from '@ghar/core/bills'
import { documentStoragePath } from '@ghar/core/documents'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@ghar/core/errors'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { beforeAll, describe, expect, it } from 'vitest'
import { createBill, deleteBill, listBillPaymentCandidates, listBills, type BillInput } from '../src/queries/bills'
import { createContact, deleteContact, getContact, listContacts, updateContact } from '../src/queries/contacts'
import {
  countDocumentsByAsset,
  createDocument,
  deleteDocument,
  getDocument,
  isDocumentFileInUse,
  listDocumentExpiries,
  listDocuments,
  updateDocument,
  type DocumentInput,
} from '../src/queries/documents'
import {
  claimExpiryReminder,
  listExpiriesForReminders,
  listReminderRecipients,
  releaseExpiryReminder,
} from '../src/queries/expiry-reminders'
import {
  completeMaintenanceTask,
  createAsset,
  createMaintenanceTask,
  deleteMaintenanceCompletion,
  getMaintenanceTask,
  listAssets,
  listMaintenanceHistory,
  listMaintenanceTasks,
  listWarrantyExpiries,
  type AssetInput,
  type MaintenanceInput,
} from '../src/queries/home'
import { createInvitation } from '../src/queries/invitations'
import { acceptInvitation, createHousehold } from '../src/queries/session'
import { createManualTransaction } from '../src/queries/trip-transactions'
import type { Db, RequestContext, SystemContext } from '../src/queries/types'
import { createAuthUser, createTestDatabase, queryAs } from './support/database'

const now = new Date()
const today = '2026-09-14'

let client: PGlite
let db: Db
let owner: RequestContext
let adult: RequestContext
let member: RequestContext
let viewer: RequestContext
let other: RequestContext

async function join(householdOwner: RequestContext, email: string, role: 'adult' | 'member' | 'viewer'): Promise<RequestContext> {
  const userId = await createAuthUser(client, email)
  await createInvitation(householdOwner, db, { email, role, tokenHash: `hash-${email}`, expiresAt: invitationExpiresAt(now) })
  await acceptInvitation({ userId, email }, db, { tokenHash: `hash-${email}`, now })
  return { userId, householdId: householdOwner.householdId, role }
}

const asset: AssetInput = {
  name: 'Water heater',
  kind: 'appliance',
  make: 'Rheem',
  model: 'XE50',
  serialNumber: 'RH-0413-99812',
  purchasedOn: '2021-10-02',
  purchasePriceCents: 129_900,
  warrantyExpiresOn: '2026-10-02',
  location: 'Garage, left of the door',
  notes: null,
}

function task(overrides: Partial<MaintenanceInput> = {}): MaintenanceInput {
  return {
    title: 'Flush the tank',
    assetId: null,
    cadenceMonths: 3,
    cadenceMiles: null,
    lastDoneOn: '2026-06-01',
    nextDueOn: null,
    assignedUserId: null,
    instructions: null,
    vendorContactId: null,
    ...overrides,
  }
}

function documentInput(overrides: Partial<DocumentInput> = {}): DocumentInput {
  return {
    title: 'Home insurance',
    kind: 'insurance',
    issuedOn: '2025-11-01',
    expiresOn: '2026-11-01',
    issuer: 'State Farm',
    referenceNumber: 'HO-3318',
    assetId: null,
    personId: null,
    notes: null,
    isSensitive: false,
    ...overrides,
  }
}

function file(ctx: RequestContext) {
  return { storagePath: documentStoragePath(ctx.householdId, randomUUID(), 'image/jpeg'), mimeType: 'image/jpeg' as const, sizeBytes: 48_213 }
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  const ownerId = await createAuthUser(client, 'owner@example.com')
  const household = await createHousehold({ userId: ownerId, email: 'owner@example.com' }, db, {
    name: 'The Rao household',
    timezone: 'America/Chicago',
    currency: 'USD',
  })
  owner = { userId: ownerId, householdId: household.household.id, role: 'owner' }
  adult = await join(owner, 'adult@example.com', 'adult')
  member = await join(owner, 'member@example.com', 'member')
  viewer = await join(owner, 'viewer@example.com', 'viewer')

  const otherId = await createAuthUser(client, 'other@example.com')
  const otherHousehold = await createHousehold({ userId: otherId, email: 'other@example.com' }, db, {
    name: 'Next door',
    timezone: 'America/Chicago',
    currency: 'USD',
  })
  other = { userId: otherId, householdId: otherHousehold.household.id, role: 'owner' }
}, 60_000)

describe('contacts', () => {
  it('saves tags cleaned up and keeps each household to its own people', async () => {
    const plumber = await createContact(member, db, {
      name: 'Dave the plumber',
      role: 'Plumber',
      phone: '(512) 555-0148',
      email: null,
      url: null,
      notes: null,
      tags: [' Plumbing ', 'plumbing', 'Emergency  calls'],
    })
    expect(plumber.tags).toEqual(['plumbing', 'emergency calls'])
    expect((await listContacts(viewer, db)).map(contact => contact.name)).toEqual(['Dave the plumber'])

    expect(await listContacts(other, db)).toEqual([])
    await expect(getContact(other, db, plumber.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(updateContact(other, db, plumber.id, { ...plumber, name: 'Taken' })).rejects.toBeInstanceOf(NotFoundError)
    await expect(deleteContact(other, db, plumber.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(createContact(viewer, db, { ...plumber, name: 'Nope' })).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('assets and maintenance', () => {
  it('works out the first due date and refuses links to another household', async () => {
    const heater = await createAsset(owner, db, asset)
    const [otherAsset, otherContact] = await Promise.all([
      createAsset(other, db, { ...asset, name: "Neighbor's heater" }),
      createContact(other, db, { name: 'Their plumber', role: null, phone: null, email: null, url: null, notes: null, tags: [] }),
    ])

    const flush = await createMaintenanceTask(member, db, task({ assetId: heater.id }))
    expect(flush).toMatchObject({ assetName: 'Water heater', lastDoneOn: '2026-06-01', nextDueOn: '2026-09-01', vendor: null })

    await expect(createMaintenanceTask(owner, db, task({ assetId: otherAsset.id }))).rejects.toBeInstanceOf(ValidationError)
    await expect(createMaintenanceTask(owner, db, task({ vendorContactId: otherContact.id }))).rejects.toBeInstanceOf(ValidationError)
    await expect(createMaintenanceTask(owner, db, task({ assignedUserId: other.userId }))).rejects.toBeInstanceOf(ValidationError)
    await expect(getMaintenanceTask(other, db, flush.id)).rejects.toBeInstanceOf(NotFoundError)
    expect(await listMaintenanceTasks(other, db)).toHaveLength(0)

    const range = { from: today, to: '2026-12-31' }
    expect((await listWarrantyExpiries(viewer, db, range)).map(a => a.id)).toEqual([heater.id])
    expect((await listWarrantyExpiries(other, db, range)).map(a => a.id)).toEqual([otherAsset.id])
  })

  it('lists a job with its vendor, soonest due first and unscheduled last', async () => {
    const [plumber] = await listContacts(owner, db)
    if (!plumber) throw new Error('expected the plumber')
    await createMaintenanceTask(owner, db, task({ title: 'Check the anode rod', cadenceMonths: null, lastDoneOn: null, vendorContactId: plumber.id }))
    await createMaintenanceTask(owner, db, task({ title: 'Test the relief valve', lastDoneOn: null, nextDueOn: '2026-08-20' }))

    const tasks = await listMaintenanceTasks(viewer, db)
    expect(tasks.map(t => t.title)).toEqual(['Test the relief valve', 'Flush the tank', 'Check the anode rod'])
    expect(tasks[2]?.vendor).toEqual({ id: plumber.id, name: 'Dave the plumber', role: 'Plumber', phone: '(512) 555-0148' })
    expect(await listMaintenanceTasks(owner, db, { vendorContactId: plumber.id })).toHaveLength(1)
  })

  it('marks a job done once, rolls it forward, and takes it back', async () => {
    const flush = (await listMaintenanceTasks(owner, db)).find(t => t.title === 'Flush the tank')
    if (!flush) throw new Error('expected the flush job')

    await expect(
      completeMaintenanceTask(member, db, flush.id, { completedOn: '2026-09-15', today, costCents: null, notes: null, documentId: null })
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      completeMaintenanceTask(viewer, db, flush.id, { completedOn: today, today, costCents: null, notes: null, documentId: null })
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      completeMaintenanceTask(other, db, flush.id, { completedOn: today, today, costCents: null, notes: null, documentId: null })
    ).rejects.toBeInstanceOf(NotFoundError)

    const done = await completeMaintenanceTask(member, db, flush.id, { completedOn: today, today, costCents: 4500, notes: null, documentId: null })
    expect(done.task).toMatchObject({ lastDoneOn: today, nextDueOn: '2026-12-14' })
    expect(done.entry).toMatchObject({ completedOn: today, completedBy: member.userId, costCents: 4500, taskTitle: 'Flush the tank' })

    // The phone retried the same tap.
    const retry = await completeMaintenanceTask(member, db, flush.id, { completedOn: today, today, costCents: 4500, notes: null, documentId: null })
    expect(retry.entry.id).toBe(done.entry.id)
    expect(retry.task.nextDueOn).toBe('2026-12-14')
    expect(await listMaintenanceHistory(owner, db, { taskId: flush.id })).toHaveLength(1)

    await expect(deleteMaintenanceCompletion(other, db, flush.id, done.entry.id)).rejects.toBeInstanceOf(NotFoundError)
    const undone = await deleteMaintenanceCompletion(member, db, flush.id, done.entry.id)
    expect(undone).toMatchObject({ lastDoneOn: null, nextDueOn: today })
    await expect(deleteMaintenanceCompletion(member, db, flush.id, done.entry.id)).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('documents', () => {
  it('hides a sensitive document from members and viewers everywhere', async () => {
    const passport = await createDocument(adult, db, {
      ...documentInput({ title: 'Passport', kind: 'id', expiresOn: '2026-10-20', issuer: null, referenceNumber: null, isSensitive: true }),
      ...file(adult),
    })
    const policy = await createDocument(member, db, { ...documentInput(), ...file(member) })
    expect(policy.uploadedBy).toBe(member.userId)

    expect((await listDocuments(owner, db)).map(d => d.title).toSorted()).toEqual(['Home insurance', 'Passport'])
    for (const ctx of [member, viewer]) {
      expect((await listDocuments(ctx, db)).map(d => d.title)).toEqual(['Home insurance'])
      await expect(getDocument(ctx, db, passport.id)).rejects.toBeInstanceOf(NotFoundError)
      expect((await listDocumentExpiries(ctx, db, { from: today, to: '2026-12-31' })).map(d => d.title)).toEqual(['Home insurance'])
    }
    await expect(updateDocument(member, db, passport.id, documentInput())).rejects.toBeInstanceOf(NotFoundError)
    await expect(deleteDocument(member, db, passport.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(updateDocument(member, db, policy.id, documentInput({ isSensitive: true }))).rejects.toBeInstanceOf(ForbiddenError)
    await expect(createDocument(member, db, { ...documentInput({ isSensitive: true }), ...file(member) })).rejects.toBeInstanceOf(
      ForbiddenError
    )

    expect(await listDocuments(other, db)).toEqual([])
    await expect(getDocument(other, db, policy.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('backs the same rule with row level security', async () => {
    const titles = async (userId: string) =>
      (await queryAs<{ title: string }>(client, userId, 'select title from documents')).map(row => row.title).toSorted()
    expect(await titles(owner.userId)).toEqual(['Home insurance', 'Passport'])
    expect(await titles(adult.userId)).toEqual(['Home insurance', 'Passport'])
    expect(await titles(member.userId)).toEqual(['Home insurance'])
    expect(await titles(viewer.userId)).toEqual(['Home insurance'])
    expect(await titles(other.userId)).toEqual([])
    expect(await queryAs(client, null, 'select id from documents')).toEqual([])

    expect(await queryAs(client, viewer.userId, 'select id from assets')).toHaveLength(1)
    expect(await queryAs(client, other.userId, 'select id from maintenance_log')).toEqual([])
    expect(await queryAs(client, member.userId, 'select id from bills')).toEqual([])
    expect(await queryAs(client, owner.userId, 'select id from expiry_reminders')).toEqual([])
  })

  it('only accepts an upload path made for the household, once', async () => {
    const theirs = file(other)
    await expect(createDocument(owner, db, { ...documentInput(), ...theirs })).rejects.toBeInstanceOf(ValidationError)
    await expect(createDocument(owner, db, { ...documentInput(), ...file(owner), storagePath: `${owner.householdId}/passport.jpg` })).rejects.toBeInstanceOf(
      ValidationError
    )

    const upload = file(owner)
    await createDocument(owner, db, { ...documentInput({ title: 'Receipt', expiresOn: null }), ...upload })
    await expect(createDocument(owner, db, { ...documentInput({ title: 'Again' }), ...upload })).rejects.toBeInstanceOf(ConflictError)
  })

  it('knows a file is in use, even by a document the caller can’t see', async () => {
    const upload = file(owner)
    await createDocument(owner, db, { ...documentInput({ title: 'Private scan', expiresOn: null, isSensitive: true }), ...upload })
    expect(await isDocumentFileInUse(member, db, upload.storagePath)).toBe(true)
    expect(await isDocumentFileInUse(member, db, file(owner).storagePath)).toBe(false)
    expect(await isDocumentFileInUse(other, db, upload.storagePath)).toBe(false)
    await expect(isDocumentFileInUse(viewer, db, upload.storagePath)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('counts documents per asset and hands back the path of a deleted one', async () => {
    const heater = await waterHeater()
    const manual = await createDocument(owner, db, { ...documentInput({ title: 'Manual', kind: 'warranty', expiresOn: null, assetId: heater.id }), ...file(owner) })
    await createDocument(owner, db, {
      ...documentInput({ title: 'Private receipt', kind: 'warranty', expiresOn: null, assetId: heater.id, isSensitive: true }),
      ...file(owner),
    })
    expect((await countDocumentsByAsset(owner, db)).get(heater.id)).toBe(2)
    expect((await countDocumentsByAsset(member, db)).get(heater.id)).toBe(1)

    const deleted = await deleteDocument(owner, db, manual.id)
    expect(deleted.storagePath).toBe(manual.storagePath)
    await expect(getDocument(owner, db, manual.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('leaves a receipt the caller may not see off the service history', async () => {
    const heater = await waterHeater()
    const job = await createMaintenanceTask(owner, db, task({ title: 'Replace the element', assetId: heater.id, lastDoneOn: null }))
    const receipt = (await listDocuments(owner, db, { assetId: heater.id })).find(d => d.isSensitive)
    if (!receipt) throw new Error('expected the private receipt')

    await expect(
      completeMaintenanceTask(member, db, job.id, { completedOn: today, today, costCents: null, notes: null, documentId: receipt.id })
    ).rejects.toBeInstanceOf(ValidationError)
    await completeMaintenanceTask(owner, db, job.id, { completedOn: today, today, costCents: 21_000, notes: 'Lower element', documentId: receipt.id })

    const [ownerEntry] = await listMaintenanceHistory(owner, db, { assetId: heater.id })
    const [memberEntry] = await listMaintenanceHistory(member, db, { assetId: heater.id })
    expect(ownerEntry).toMatchObject({ taskTitle: 'Replace the element', documentId: receipt.id })
    expect(memberEntry).toMatchObject({ taskTitle: 'Replace the element', documentId: null, costCents: 21_000 })
    expect(await listMaintenanceHistory(other, db, { assetId: heater.id })).toEqual([])
  })

  async function waterHeater() {
    const heater = (await listAssets(owner, db)).find(a => a.name === 'Water heater')
    if (!heater) throw new Error('expected the water heater')
    return heater
  }
})

describe('bills', () => {
  const water: BillInput = {
    name: 'Water',
    payee: 'City Water',
    amountCents: 6000,
    isVariable: false,
    cadence: 'monthly',
    dueDay: 10,
    dueMonth: null,
    autopay: false,
    accountId: null,
    categoryId: null,
    url: 'https://water.example.com',
    notes: null,
  }

  it('keeps bills to owners and adults', async () => {
    await expect(listBills(member, db)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(createBill(member, db, water)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(createBill(owner, db, { ...water, dueMonth: 4 })).rejects.toBeInstanceOf(ValidationError)
    await expect(createBill(owner, db, { ...water, cadence: 'annual' })).rejects.toBeInstanceOf(ValidationError)
  })

  it('finds the payment that paid this month', async () => {
    const bill = await createBill(adult, db, water)
    expect(bill.accountName).toBeNull()
    const payment = await createManualTransaction(owner, db, {
      date: '2026-09-08',
      name: 'CITY WATER ONLINE PMT',
      merchantName: 'City Water',
      amountCents: -6000,
      tripId: null,
    })
    await createManualTransaction(owner, db, { date: '2026-09-09', name: 'Refund', merchantName: 'City Water', amountCents: 6000, tripId: null })
    await createManualTransaction(other, db, { date: '2026-09-08', name: 'City Water', merchantName: 'City Water', amountCents: -6000, tripId: null })

    const candidates = await listBillPaymentCandidates(owner, db, { from: '2026-08-01', to: today })
    expect(candidates.map(c => c.id)).toEqual([payment.id])

    const occurrences = matchBillPayments({
      bill,
      dueDates: billDueDates(bill, '2026-09-01', '2026-10-31'),
      transactions: candidates,
      today,
      trackedFrom: '2026-09-01',
    })
    expect(occurrences.find(o => o.dueOn === '2026-09-10')?.payment?.transactionId).toBe(payment.id)

    expect(await listBills(other, db)).toEqual([])
    await expect(deleteBill(other, db, bill.id)).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('expiry reminders', () => {
  it('claims each reminder once, including for sensitive documents', async () => {
    const system: SystemContext = { householdId: owner.householdId, userId: null }
    const subjects = await listExpiriesForReminders(system, db, { from: today, to: '2026-11-13' })
    expect(subjects.map(s => `${s.kind}:${s.title}`)).toEqual(['warranty:Water heater', 'document:Passport', 'document:Home insurance'])
    // An ID's reminders start six months out, everything else's two.
    expect(subjects.map(s => s.leadDays)).toEqual([60, 180, 60])
    expect(await listExpiriesForReminders({ householdId: other.householdId, userId: null }, db, { from: today, to: '2026-09-30' })).toEqual([])

    const [heater] = subjects
    if (!heater) throw new Error('expected the warranty')
    const claim = await claimExpiryReminder(system, db, { subject: heater, thresholdDays: 30 })
    expect(claim).toEqual(expect.any(String))
    expect(await claimExpiryReminder(system, db, { subject: heater, thresholdDays: 30 })).toBeNull()
    // Once a closer reminder went, a farther one isn't news, as when the lead time was moved out.
    expect(await claimExpiryReminder(system, db, { subject: heater, thresholdDays: 60 })).toBeNull()
    expect(await claimExpiryReminder(system, db, { subject: heater, thresholdDays: 7 })).toEqual(expect.any(String))

    if (claim === null) throw new Error('expected a claim')
    await releaseExpiryReminder(system, db, claim)
    expect(await claimExpiryReminder(system, db, { subject: heater, thresholdDays: 30 })).toBeNull()

    // A renewed warranty starts its reminders over.
    expect(await claimExpiryReminder(system, db, { subject: { ...heater, expiresOn: '2027-10-02' }, thresholdDays: 30 })).toEqual(
      expect.any(String)
    )
  })

  it('goes to owners and adults with an email address', async () => {
    const recipients = await listReminderRecipients({ householdId: owner.householdId, userId: null }, db)
    expect(recipients.map(r => r.email)).toEqual(['owner@example.com', 'adult@example.com'])
    await expect(listReminderRecipients(member, db)).rejects.toBeInstanceOf(ForbiddenError)
  })
})
