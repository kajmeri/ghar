import type { PGlite } from '@electric-sql/pglite'
import type { CalendarDate } from '@ghar/core/dates'
import { documentStoragePath, type DocumentKind } from '@ghar/core/documents'
import {
  createAsset,
  createDocument,
  createHousehold,
  createRenewal,
  getRenewal,
  updateRenewal,
  type Db,
  type RenewalInput,
  type RequestContext,
} from '@ghar/db/queries'
import { beforeAll, describe, expect, it } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { runExpiryReminders } from '@/lib/documents/expiry-reminders'
import { createMemoryProvider, EmailDeliveryError, type EmailProvider } from '@/lib/providers/email'

// The whole reminder job against a real schema, with an in-memory inbox.

let client: PGlite
let db: Db

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
})

let households = 0

/** Each test gets its own household, and reminds only that. */
async function household(): Promise<{ ctx: RequestContext; email: string }> {
  households += 1
  const email = `owner-${households}@example.com`
  const userId = await createAuthUser(client, email)
  const { household: row } = await createHousehold({ userId, email }, db, {
    name: `Household ${households}`,
    timezone: 'America/New_York',
    currency: 'USD',
  })
  return { ctx: { userId, householdId: row.id, role: 'owner' }, email }
}

function addDocument(
  ctx: RequestContext,
  input: { title: string; expiresOn: CalendarDate; kind?: DocumentKind; remindFromDays?: number | null; isSensitive?: boolean }
) {
  return createDocument(ctx, db, {
    title: input.title,
    kind: input.kind ?? 'insurance',
    issuedOn: null,
    expiresOn: input.expiresOn,
    remindFromDays: input.remindFromDays ?? null,
    issuer: null,
    referenceNumber: 'X1234567',
    assetId: null,
    notes: null,
    isSensitive: input.isSensitive ?? false,
    storagePath: documentStoragePath(ctx.householdId, crypto.randomUUID(), 'application/pdf'),
    mimeType: 'application/pdf',
    sizeBytes: 2048,
  })
}

/** Runs the job at 11am New York time on `today`. */
function run(ctx: RequestContext, email: EmailProvider, today: CalendarDate) {
  return runExpiryReminders(
    { db, email, appUrl: 'https://ghar.test', now: new Date(`${today}T15:00:00Z`) },
    { householdId: ctx.householdId }
  )
}

describe('expiry reminders', () => {
  it('moves an automatic renewal on, then says when it renews', async () => {
    const { ctx } = await household()
    const streaming = await createRenewal(ctx, db, {
      title: 'Streaming',
      kind: 'membership',
      expiresOn: '2026-09-15',
      cadenceMonths: 1,
      autoRenews: true,
      costCents: 1_599,
      provider: null,
      referenceNumber: 'M-99812',
      url: null,
      contactId: null,
      assetId: null,
      documentId: null,
      notes: null,
    })
    const inbox = createMemoryProvider()

    const result = await run(ctx, inbox, '2026-10-02')
    expect(result).toMatchObject({ renewed: 1, subjects: 1, reminded: 1 })
    expect((await getRenewal(ctx, db, streaming.id)).expiresOn).toBe('2026-10-15')
    const [reminder] = inbox.sent
    expect(reminder?.subject).toBe('Streaming renews in 13 days')
    expect(reminder?.text).toContain('cancel before then')
    expect(reminder?.text).toContain(`https://ghar.test/renewals/${streaming.id}`)
    expect(reminder?.text).not.toContain('M-99812')

    expect(await run(ctx, inbox, '2026-10-02')).toMatchObject({ renewed: 0, reminded: 0 })
  })

  it('sends one reminder at 60, 30 and 7 days, and never twice', async () => {
    const { ctx, email } = await household()
    const passport = await addDocument(ctx, { title: 'Passport', kind: 'other', expiresOn: '2026-12-01' })
    const inbox = createMemoryProvider()

    await run(ctx, inbox, '2026-10-01')
    expect(inbox.sent).toHaveLength(0)

    const first = await run(ctx, inbox, '2026-10-02')
    expect(first).toMatchObject({ subjects: 1, reminded: 1, emails: 1 })
    const [reminder] = inbox.sent
    expect(reminder?.to).toBe(email)
    expect(reminder?.subject).toBe('Passport expires in 60 days')
    expect(reminder?.text).toContain(`https://ghar.test/documents/${passport.id}`)
    expect(reminder?.text).not.toContain('X1234567')
    expect(reminder?.html).not.toContain('X1234567')
    expect(reminder?.text).toContain('Ghar sends a reminder 60, 30 and 7 days before')

    const again = await run(ctx, inbox, '2026-10-02')
    expect(again).toMatchObject({ reminded: 0, skipped: 1 })
    await run(ctx, inbox, '2026-10-15')
    expect(inbox.sent).toHaveLength(1)

    await run(ctx, inbox, '2026-11-01')
    await run(ctx, inbox, '2026-11-02')
    await run(ctx, inbox, '2026-11-24')
    await run(ctx, inbox, '2026-12-02')
    expect(inbox.sent.map(message => message.subject)).toEqual([
      'Passport expires in 60 days',
      'Passport expires in 30 days',
      'Passport expires in 7 days',
    ])
  })

  it('starts six months ahead for an ID, since those take longest to renew', async () => {
    const { ctx } = await household()
    await addDocument(ctx, { title: 'Passport', kind: 'id', expiresOn: '2027-03-31' })
    const inbox = createMemoryProvider()

    await run(ctx, inbox, '2026-10-01')
    expect(inbox.sent).toHaveLength(0)
    await run(ctx, inbox, '2026-10-02')
    await run(ctx, inbox, '2027-01-30')
    await run(ctx, inbox, '2027-03-01')
    // 180 days out is five months and 29 days, and a reminder never rounds a date closer.
    expect(inbox.sent.map(message => message.subject)).toEqual(['Passport expires in 5 months', 'Passport expires in 30 days'])
    expect(inbox.sent[0]?.text).toContain('Ghar sends a reminder 6 months, 30 and 7 days before')
  })

  it('starts when the household asked for this one', async () => {
    const { ctx } = await household()
    const input: RenewalInput = {
      title: 'Gym',
      kind: 'membership',
      expiresOn: '2026-11-20',
      remindFromDays: 14,
      cadenceMonths: null,
      autoRenews: false,
      costCents: null,
      provider: null,
      referenceNumber: null,
      url: null,
      contactId: null,
      assetId: null,
      documentId: null,
      notes: null,
    }
    const gym = await createRenewal(ctx, db, input)
    const inbox = createMemoryProvider()

    // Nothing at 60 or 30 days out: the first one goes at 14.
    await run(ctx, inbox, '2026-09-21')
    await run(ctx, inbox, '2026-10-21')
    await run(ctx, inbox, '2026-11-05')
    expect(inbox.sent).toHaveLength(0)
    await run(ctx, inbox, '2026-11-06')
    expect(inbox.sent.map(message => message.subject)).toEqual(['Gym expires in 14 days'])
    expect(inbox.sent[0]?.text).toContain('Ghar sends a reminder 14 and 7 days before')

    // Moving it further out after that doesn't send the same news again.
    await updateRenewal(ctx, db, gym.id, { ...input, remindFromDays: 90 })
    await run(ctx, inbox, '2026-11-07')
    expect(inbox.sent).toHaveLength(1)
    await run(ctx, inbox, '2026-11-13')
    expect(inbox.sent.map(message => message.subject)).toEqual(['Gym expires in 14 days', 'Gym expires in 7 days'])
  })

  it('catches up a missed day with one reminder, not one per tier', async () => {
    const { ctx } = await household()
    await addDocument(ctx, { title: 'Car registration', expiresOn: '2026-10-20' })
    const inbox = createMemoryProvider()

    await run(ctx, inbox, '2026-10-15')
    await run(ctx, inbox, '2026-10-16')
    expect(inbox.sent.map(message => message.subject)).toEqual(['Car registration expires in 5 days'])
  })

  it('includes sensitive documents and warranties', async () => {
    const { ctx } = await household()
    await addDocument(ctx, { title: 'Birth certificate', kind: 'id', expiresOn: '2026-10-14', isSensitive: true })
    const dishwasher = await createAsset(ctx, db, {
      name: 'Dishwasher',
      kind: 'appliance',
      make: 'Bosch',
      model: null,
      serialNumber: null,
      purchasedOn: null,
      purchasePriceCents: null,
      warrantyExpiresOn: '2026-10-14',
      location: 'Kitchen',
      notes: null,
    })
    const inbox = createMemoryProvider()

    await run(ctx, inbox, '2026-09-14')
    expect(inbox.sent.map(message => message.subject)).toEqual([
      'Birth certificate expires in 30 days',
      'Dishwasher warranty expires in 30 days',
    ])
    expect(inbox.sent[1]?.text).toContain(`https://ghar.test/home/assets/${dishwasher.id}`)
  })

  it('gives the reminder back when the email fails, so the next run sends it', async () => {
    const { ctx } = await household()
    await addDocument(ctx, { title: 'Home insurance', expiresOn: '2026-09-21' })
    const down: EmailProvider = { send: () => Promise.reject(new EmailDeliveryError('Resend is down')) }

    const failed = await run(ctx, down, '2026-09-14')
    expect(failed).toMatchObject({ reminded: 0, errors: 1 })

    const inbox = createMemoryProvider()
    const retried = await run(ctx, inbox, '2026-09-14')
    expect(retried).toMatchObject({ reminded: 1, errors: 0 })
    expect(inbox.sent.map(message => message.subject)).toEqual(['Home insurance expires in 7 days'])
  })
})
