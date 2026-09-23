import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { documentStoragePath } from '@ghar/core/documents'
import { ForbiddenError, NotFoundError, ValidationError } from '@ghar/core/errors'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { beforeAll, describe, expect, it } from 'vitest'
import { createContact } from '../src/queries/contacts'
import { createDocument } from '../src/queries/documents'
import { claimExpiryReminder, listExpiriesForReminders } from '../src/queries/expiry-reminders'
import { createAsset } from '../src/queries/home'
import { createInvitation } from '../src/queries/invitations'
import {
  createRenewal,
  deleteRenewal,
  getRenewal,
  listExpiriesPage,
  listRenewalExpiries,
  rollForwardRenewals,
  updateRenewal,
  type ExpiryRow,
  type RenewalInput,
} from '../src/queries/renewals'
import { acceptInvitation, createHousehold } from '../src/queries/session'
import type { Db, RequestContext, SystemContext } from '../src/queries/types'
import { createAuthUser, createTestDatabase, queryAs } from './support/database'

const now = new Date()

let client: PGlite
let db: Db
let owner: RequestContext
let member: RequestContext
let viewer: RequestContext
let other: RequestContext

async function join(householdOwner: RequestContext, email: string, role: 'adult' | 'member' | 'viewer'): Promise<RequestContext> {
  const userId = await createAuthUser(client, email)
  await createInvitation(householdOwner, db, { email, role, tokenHash: `hash-${email}`, expiresAt: invitationExpiresAt(now) })
  await acceptInvitation({ userId, email }, db, { tokenHash: `hash-${email}`, now })
  return { userId, householdId: householdOwner.householdId, role }
}

function renewal(overrides: Partial<RenewalInput> = {}): RenewalInput {
  return {
    title: 'Car registration',
    kind: 'registration',
    expiresOn: '2026-10-31',
    cadenceMonths: 12,
    autoRenews: false,
    costCents: 8_450,
    provider: 'Texas DMV',
    referenceNumber: null,
    url: 'https://www.txdmv.gov',
    contactId: null,
    assetId: null,
    documentId: null,
    personId: null,
    notes: null,
    ...overrides,
  }
}

async function makeHousehold(email: string, name: string): Promise<RequestContext> {
  const userId = await createAuthUser(client, email)
  const household = await createHousehold({ userId, email }, db, { name, timezone: 'America/Chicago', currency: 'USD' })
  return { userId, householdId: household.household.id, role: 'owner' }
}

async function passport(ctx: RequestContext, expiresOn: string) {
  return createDocument(ctx, db, {
    title: 'Passport',
    kind: 'id',
    issuedOn: null,
    expiresOn,
    issuer: null,
    referenceNumber: null,
    assetId: null,
    personId: null,
    notes: null,
    isSensitive: true,
    storagePath: documentStoragePath(ctx.householdId, randomUUID(), 'image/jpeg'),
    mimeType: 'image/jpeg',
    sizeBytes: 1_024,
  })
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  owner = await makeHousehold('owner@example.com', 'The Rao household')
  member = await join(owner, 'member@example.com', 'member')
  viewer = await join(owner, 'viewer@example.com', 'viewer')
  other = await makeHousehold('other@example.com', 'Next door')
}, 60_000)

describe('renewals', () => {
  it('are created, read, replaced and deleted inside the household', async () => {
    const car = await createAsset(owner, db, {
      name: 'Honda CR-V',
      kind: 'vehicle',
      make: null,
      model: null,
      serialNumber: null,
      purchasedOn: null,
      purchasePriceCents: null,
      warrantyExpiresOn: null,
      location: null,
      notes: null,
    })
    const dmv = await createContact(owner, db, {
      name: 'Travis County tax office',
      role: null,
      phone: null,
      email: null,
      url: null,
      notes: null,
      tags: [],
    })
    const created = await createRenewal(owner, db, renewal({ assetId: car.id, contactId: dmv.id }))
    expect(created).toMatchObject({ title: 'Car registration', assetName: 'Honda CR-V', contactName: 'Travis County tax office' })

    expect((await getRenewal(viewer, db, created.id)).title).toBe('Car registration')
    await expect(getRenewal(other, db, created.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(createRenewal(viewer, db, renewal())).rejects.toBeInstanceOf(ForbiddenError)
    await expect(createRenewal(other, db, renewal({ assetId: car.id }))).rejects.toBeInstanceOf(ValidationError)
    await expect(updateRenewal(other, db, created.id, renewal())).rejects.toBeInstanceOf(NotFoundError)

    const updated = await updateRenewal(member, db, created.id, renewal({ title: 'CR-V registration', assetId: car.id }))
    expect(updated).toMatchObject({ title: 'CR-V registration', contactName: null, assetName: 'Honda CR-V' })

    await expect(deleteRenewal(other, db, created.id)).rejects.toBeInstanceOf(NotFoundError)
    await deleteRenewal(owner, db, created.id)
    await expect(getRenewal(owner, db, created.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('show a linked sensitive document only to those who can see it', async () => {
    const scan = await passport(owner, '2031-04-02')
    const linked = await createRenewal(owner, db, renewal({ title: 'Passport', kind: 'other', documentId: scan.id }))
    expect(linked.documentTitle).toBe('Passport')
    expect((await getRenewal(member, db, linked.id)).documentTitle).toBeNull()
    await expect(createRenewal(member, db, renewal({ documentId: scan.id }))).rejects.toBeInstanceOf(ValidationError)
    await deleteRenewal(owner, db, linked.id)
  })

  it('are readable through RLS by members only', async () => {
    const created = await createRenewal(owner, db, renewal({ title: 'Costco' }))
    const sql = `select title from renewals where id = '${created.id}'`
    expect(await queryAs(client, member.userId, sql)).toEqual([{ title: 'Costco' }])
    expect(await queryAs(client, other.userId, sql)).toEqual([])
    await deleteRenewal(owner, db, created.id)
  })

  it('need a cadence to renew on their own', async () => {
    await expect(createRenewal(owner, db, renewal({ autoRenews: true, cadenceMonths: null }))).rejects.toThrow()
  })
})

describe('the expiries list', () => {
  it('merges documents, warranties and renewals by date, a page at a time', async () => {
    const ctx = await makeHousehold('pages@example.com', 'Paging')
    const kid = await join(ctx, 'kid@example.com', 'member')
    await passport(ctx, '2026-10-05')
    await createAsset(ctx, db, {
      name: 'Dishwasher',
      kind: 'appliance',
      make: null,
      model: null,
      serialNumber: null,
      purchasedOn: null,
      purchasePriceCents: null,
      warrantyExpiresOn: '2026-10-05',
      location: null,
      notes: null,
    })
    for (const [title, expiresOn] of [
      ['Lease', '2026-08-01'],
      ['Registration', '2026-10-05'],
      ['Costco', '2026-12-01'],
      ['Insurance', '2027-01-15'],
    ] as const) {
      await createRenewal(ctx, db, renewal({ title, expiresOn }))
    }

    const all: ExpiryRow[] = []
    let after = null
    let pages = 0
    do {
      const page = await listExpiriesPage(ctx, db, {}, { after, limit: 2 })
      all.push(...page.rows)
      after = page.next
      pages += 1
    } while (after !== null)
    expect(pages).toBe(3)
    expect(all.map(row => row.expiresOn)).toEqual(['2026-08-01', '2026-10-05', '2026-10-05', '2026-10-05', '2026-12-01', '2027-01-15'])
    expect(all.map(row => row.kind).toSorted()).toEqual(['document', 'renewal', 'renewal', 'renewal', 'renewal', 'warranty'])
    // Within a day, by id, whichever table the row came from.
    const sameDay = all.filter(row => row.expiresOn === '2026-10-05').map(row => row.id)
    expect(sameDay).toEqual(sameDay.toSorted())

    const later = await listExpiriesPage(ctx, db, { from: '2026-10-06' }, { after: null, limit: 10 })
    expect(later.rows.map(row => row.title)).toEqual(['Costco', 'Insurance'])

    const forKid = await listExpiriesPage(kid, db, {}, { after: null, limit: 10 })
    expect(forKid.rows.some(row => row.kind === 'document')).toBe(false)
    expect(forKid.rows).toHaveLength(5)

    const range = await listRenewalExpiries(ctx, db, { from: '2026-10-01', to: '2026-12-31' })
    expect(range.map(row => row.title)).toEqual(['Registration', 'Costco'])
  })
})

describe('automatic renewals', () => {
  it('move on to the end of the current term, once', async () => {
    const ctx = await makeHousehold('auto@example.com', 'Auto')
    const system: SystemContext = { householdId: ctx.householdId, userId: null }
    const netflix = await createRenewal(
      ctx,
      db,
      renewal({ title: 'Streaming', expiresOn: '2026-07-31', cadenceMonths: 1, autoRenews: true })
    )
    const manual = await createRenewal(ctx, db, renewal({ title: 'License', expiresOn: '2026-07-31' }))

    expect(await rollForwardRenewals(system, db, '2026-09-23')).toBe(1)
    expect((await getRenewal(ctx, db, netflix.id)).expiresOn).toBe('2026-09-30')
    expect((await getRenewal(ctx, db, manual.id)).expiresOn).toBe('2026-07-31')
    expect(await rollForwardRenewals(system, db, '2026-09-23')).toBe(0)
    await expect(rollForwardRenewals(await join(ctx, 'viewer2@example.com', 'viewer'), db, '2026-09-23')).rejects.toBeInstanceOf(
      ForbiddenError
    )
  })

  it('get reminders like anything else that runs out', async () => {
    const ctx = await makeHousehold('remind@example.com', 'Remind')
    const system: SystemContext = { householdId: ctx.householdId, userId: null }
    await createRenewal(ctx, db, renewal({ title: 'Costco', expiresOn: '2026-10-10', cadenceMonths: 12, autoRenews: true }))
    const subjects = await listExpiriesForReminders(system, db, { from: '2026-09-23', to: '2026-10-23' })
    expect(subjects).toEqual([expect.objectContaining({ kind: 'renewal', title: 'Costco', autoRenews: true })])
    const [costco] = subjects
    if (!costco) throw new Error('expected the renewal')
    expect(await claimExpiryReminder(system, db, { subject: costco, thresholdDays: 30 })).toEqual(expect.any(String))
    expect(await claimExpiryReminder(system, db, { subject: costco, thresholdDays: 30 })).toBeNull()
  })

  it('start reminding when the household asked, between a week and a year out', async () => {
    const ctx = await makeHousehold('lead@example.com', 'Lead')
    const system: SystemContext = { householdId: ctx.householdId, userId: null }
    await createRenewal(ctx, db, renewal({ title: 'Gym', expiresOn: '2026-10-10', remindFromDays: 14 }))
    await createRenewal(ctx, db, renewal({ title: 'Library card', expiresOn: '2026-10-11' }))
    const subjects = await listExpiriesForReminders(system, db, { from: '2026-09-23', to: '2026-10-23' })
    expect(subjects.map(s => [s.title, s.leadDays])).toEqual([
      ['Gym', 14],
      ['Library card', 60],
    ])
    await expect(createRenewal(ctx, db, renewal({ title: 'Too soon', expiresOn: '2026-10-10', remindFromDays: 6 }))).rejects.toThrow()
    await expect(createRenewal(ctx, db, renewal({ title: 'Too far', expiresOn: '2026-10-10', remindFromDays: 366 }))).rejects.toThrow()
  })
})
