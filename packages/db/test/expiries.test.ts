import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { documentStoragePath } from '@ghar/core/documents'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@ghar/core/errors'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { beforeAll, describe, expect, it } from 'vitest'
import { createActionToken } from '../src/queries/action-tokens'
import { createDocument, getDocument, listDocumentExpiries } from '../src/queries/documents'
import { clearNotRenewing, getExpiry, markNotRenewing, renewExpiry } from '../src/queries/expiries'
import { claimExpiryReminder, listExpiriesForReminders } from '../src/queries/expiry-reminders'
import { createAsset, listWarrantyExpiries } from '../src/queries/home'
import { createInvitation } from '../src/queries/invitations'
import { createRenewal, getRenewal, listExpiriesPage, rollForwardRenewals, type RenewalInput } from '../src/queries/renewals'
import { acceptInvitation, createHousehold } from '../src/queries/session'
import type { Db, RequestContext, SystemContext } from '../src/queries/types'
import { createAuthUser, createTestDatabase, queryAs } from './support/database'

const now = new Date()

let client: PGlite
let db: Db
let emails = 0

async function makeHousehold(): Promise<RequestContext> {
  emails += 1
  const email = `owner${emails}@example.com`
  const userId = await createAuthUser(client, email)
  const household = await createHousehold({ userId, email }, db, { name: `Household ${emails}`, timezone: 'America/Chicago', currency: 'USD' })
  return { userId, householdId: household.household.id, role: 'owner' }
}

async function join(owner: RequestContext, role: 'adult' | 'member' | 'viewer'): Promise<RequestContext> {
  emails += 1
  const email = `${role}${emails}@example.com`
  const userId = await createAuthUser(client, email)
  await createInvitation(owner, db, { email, role, tokenHash: `hash-${email}`, expiresAt: invitationExpiresAt(now) })
  await acceptInvitation({ userId, email }, db, { tokenHash: `hash-${email}`, now })
  return { userId, householdId: owner.householdId, role }
}

function renewal(overrides: Partial<RenewalInput> = {}): RenewalInput {
  return {
    title: 'Car registration',
    kind: 'registration',
    expiresOn: '2026-10-31',
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
    ...overrides,
  }
}

async function passport(ctx: RequestContext, input: { expiresOn: string; issuedOn?: string; isSensitive?: boolean }) {
  return createDocument(ctx, db, {
    title: 'Passport',
    kind: 'id',
    issuedOn: input.issuedOn ?? null,
    expiresOn: input.expiresOn,
    issuer: null,
    referenceNumber: null,
    assetId: null,
    personId: null,
    notes: null,
    isSensitive: input.isSensitive ?? false,
    storagePath: documentStoragePath(ctx.householdId, randomUUID(), 'image/jpeg'),
    mimeType: 'image/jpeg',
    sizeBytes: 1_024,
  })
}

async function dishwasher(ctx: RequestContext, warrantyExpiresOn: string) {
  return createAsset(ctx, db, {
    name: 'Dishwasher',
    kind: 'appliance',
    make: null,
    model: null,
    serialNumber: null,
    purchasedOn: null,
    purchasePriceCents: null,
    warrantyExpiresOn,
    location: null,
    notes: null,
  })
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
})

describe('not renewing', () => {
  it('holds for the date it was said about, and a new date brings the thing back', async () => {
    const owner = await makeHousehold()
    const system: SystemContext = { householdId: owner.householdId, userId: null }
    const costco = await createRenewal(owner, db, renewal({ title: 'Costco', expiresOn: '2026-10-10' }))
    const subject = { kind: 'renewal' as const, id: costco.id }
    const range = { from: '2026-09-23', to: '2026-12-31' }

    expect((await listExpiriesForReminders(system, db, range)).map(row => row.title)).toEqual(['Costco'])
    const before = await getRenewal(owner, db, costco.id)

    const marked = await markNotRenewing(owner, db, { subject, expiresOn: '2026-10-10' })
    expect(marked).toMatchObject({ kind: 'renewal', notRenewing: true })
    // Saying it twice changes nothing.
    await markNotRenewing(owner, db, { subject, expiresOn: '2026-10-10' })
    expect(await listExpiriesForReminders(system, db, range)).toEqual([])
    const after = await getRenewal(owner, db, costco.id)
    expect(after.notRenewing).toBe(true)
    // Phones pick the change up through sync.
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime())
    expect((await listExpiriesPage(owner, db, {}, { after: null, limit: 10 })).rows).toEqual([
      expect.objectContaining({ id: costco.id, notRenewing: true }),
    ])

    const renewed = await renewExpiry(owner, db, { subject, expiresOn: '2027-10-10' })
    expect(renewed.expiry).toMatchObject({ expiresOn: '2027-10-10', notRenewing: false })
    expect((await listExpiriesForReminders(system, db, { from: '2026-09-23', to: '2027-12-31' })).map(row => row.title)).toEqual([
      'Costco',
    ])
  })

  it('refuses a date that has moved since, and can be taken back', async () => {
    const owner = await makeHousehold()
    const asset = await dishwasher(owner, '2026-11-01')
    const subject = { kind: 'warranty' as const, id: asset.id }

    await expect(markNotRenewing(owner, db, { subject, expiresOn: '2026-10-01' })).rejects.toBeInstanceOf(ConflictError)
    await markNotRenewing(owner, db, { subject, expiresOn: '2026-11-01' })
    expect(await listWarrantyExpiries(owner, db, { from: '2026-10-01', to: '2026-12-31' })).toEqual([
      expect.objectContaining({ id: asset.id, notRenewing: true }),
    ])

    expect(await clearNotRenewing(owner, db, subject)).toMatchObject({ notRenewing: false })
    // Fine when there's nothing to take back.
    expect(await clearNotRenewing(owner, db, subject)).toMatchObject({ notRenewing: false })
    expect((await getExpiry(owner, db, subject)).notRenewing).toBe(false)
  })

  it('stops an automatic renewal from moving on', async () => {
    const owner = await makeHousehold()
    const system: SystemContext = { householdId: owner.householdId, userId: null }
    const gym = await createRenewal(owner, db, renewal({ title: 'Gym', expiresOn: '2026-08-31', cadenceMonths: 1, autoRenews: true }))
    await markNotRenewing(owner, db, { subject: { kind: 'renewal', id: gym.id }, expiresOn: '2026-08-31' })
    expect(await rollForwardRenewals(system, db, '2026-09-23')).toBe(0)
    expect((await getRenewal(owner, db, gym.id)).expiresOn).toBe('2026-08-31')
  })

  it('follows each kind’s permissions and never crosses households', async () => {
    const owner = await makeHousehold()
    const member = await join(owner, 'member')
    const viewer = await join(owner, 'viewer')
    const neighbour = await makeHousehold()
    const secret = await passport(owner, { expiresOn: '2027-01-01', isSensitive: true })
    const open = await passport(owner, { expiresOn: '2027-01-01' })

    // A member can't see a sensitive document, so it doesn't exist for them.
    await expect(markNotRenewing(member, db, { subject: { kind: 'document', id: secret.id }, expiresOn: '2027-01-01' })).rejects.toBeInstanceOf(
      NotFoundError
    )
    await markNotRenewing(member, db, { subject: { kind: 'document', id: open.id }, expiresOn: '2027-01-01' })
    await expect(clearNotRenewing(viewer, db, { kind: 'document', id: open.id })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(getExpiry(neighbour, db, { kind: 'document', id: open.id })).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      markNotRenewing(neighbour, db, { subject: { kind: 'document', id: open.id }, expiresOn: '2027-01-01' })
    ).rejects.toBeInstanceOf(NotFoundError)

    const sql = `select expires_on::text from expiry_dismissals where document_id = '${open.id}'`
    expect(await queryAs(client, member.userId, sql)).toEqual([{ expires_on: '2027-01-01' }])
    expect(await queryAs(client, neighbour.userId, sql)).toEqual([])
  })
})

describe('renewing', () => {
  it('moves a document on and swaps in the new one’s file and issue date', async () => {
    const owner = await makeHousehold()
    const document = await passport(owner, { expiresOn: '2026-12-01', issuedOn: '2016-12-01' })
    const subject = { kind: 'document' as const, id: document.id }
    expect(await getExpiry(owner, db, subject)).toMatchObject({ issuedOn: '2016-12-01', notRenewing: false })

    await expect(renewExpiry(owner, db, { subject, expiresOn: '2026-12-01' })).rejects.toBeInstanceOf(ValidationError)
    await expect(renewExpiry(owner, db, { subject, expiresOn: '2026-01-01' })).rejects.toBeInstanceOf(ValidationError)
    await expect(renewExpiry(owner, db, { subject, expiresOn: '2036-12-01', issuedOn: '2037-01-01' })).rejects.toBeInstanceOf(ValidationError)

    const storagePath = documentStoragePath(owner.householdId, randomUUID(), 'application/pdf')
    const result = await renewExpiry(owner, db, {
      subject,
      expiresOn: '2036-12-01',
      issuedOn: '2026-11-02',
      file: { storagePath, mimeType: 'application/pdf', sizeBytes: 2_048 },
    })
    expect(result.replacedStoragePath).toBe(document.storagePath)
    const saved = await getDocument(owner, db, document.id)
    expect(saved).toMatchObject({ expiresOn: '2036-12-01', issuedOn: '2026-11-02', storagePath, mimeType: 'application/pdf', sizeBytes: 2_048 })
    expect(await listDocumentExpiries(owner, db, { from: '2036-01-01', to: '2036-12-31' })).toEqual([
      expect.objectContaining({ id: document.id, notRenewing: false }),
    ])

    // Without the new issue date, the old one goes rather than stay wrong.
    await renewExpiry(owner, db, { subject, expiresOn: '2046-12-01' })
    expect((await getDocument(owner, db, document.id)).issuedOn).toBeNull()

    // Only a document has a file or an issue date.
    const asset = await dishwasher(owner, '2026-11-01')
    await expect(
      renewExpiry(owner, db, { subject: { kind: 'warranty', id: asset.id }, expiresOn: '2027-11-01', file: { storagePath, mimeType: 'application/pdf', sizeBytes: 1 } })
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      renewExpiry(owner, db, { subject: { kind: 'warranty', id: asset.id }, expiresOn: '2027-11-01', issuedOn: '2026-11-01' })
    ).rejects.toBeInstanceOf(ValidationError)
    const extended = await renewExpiry(owner, db, { subject: { kind: 'warranty', id: asset.id }, expiresOn: '2027-11-01' })
    expect(extended).toEqual({ expiry: expect.objectContaining({ expiresOn: '2027-11-01' }), replacedStoragePath: null })
  })

  it('starts reminders over for the new date', async () => {
    const owner = await makeHousehold()
    const system: SystemContext = { householdId: owner.householdId, userId: null }
    const lease = await createRenewal(owner, db, renewal({ title: 'Lease', expiresOn: '2026-10-10' }))
    const [first] = await listExpiriesForReminders(system, db, { from: '2026-09-23', to: '2026-12-31' })
    if (!first) throw new Error('expected the lease')
    expect(await claimExpiryReminder(system, db, { subject: first, thresholdDays: 30 })).toEqual(expect.any(String))

    await renewExpiry(owner, db, { subject: { kind: 'renewal', id: lease.id }, expiresOn: '2026-11-10' })
    const [second] = await listExpiriesForReminders(system, db, { from: '2026-09-23', to: '2026-12-31' })
    if (!second) throw new Error('expected the lease')
    expect(await claimExpiryReminder(system, db, { subject: second, thresholdDays: 30 })).toEqual(expect.any(String))
  })
})

describe('not renewing links', () => {
  it('are made only for what the person can change and see', async () => {
    const owner = await makeHousehold()
    const member = await join(owner, 'member')
    const viewer = await join(owner, 'viewer')
    const secret = await passport(owner, { expiresOn: '2027-01-01', isSensitive: true })
    const asset = await dishwasher(owner, '2026-11-01')
    const expiresAt = new Date(now.getTime() + 3_600_000)
    const grant = (userId: string, action: 'not_renewing_document' | 'not_renewing_warranty', entityId: string) => ({
      userId,
      action,
      entityId,
      dueOn: '2027-01-01',
      expiresAt,
    })

    expect(await createActionToken(owner, db, grant(owner.userId, 'not_renewing_document', secret.id))).toEqual({ id: expect.any(String) })
    await expect(createActionToken(member, db, grant(member.userId, 'not_renewing_document', secret.id))).rejects.toBeInstanceOf(NotFoundError)
    await expect(createActionToken(viewer, db, grant(viewer.userId, 'not_renewing_warranty', asset.id))).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      createActionToken(owner, db, { ...grant(owner.userId, 'not_renewing_warranty', asset.id), dueOn: null })
    ).rejects.toBeInstanceOf(ValidationError)
  })
})
