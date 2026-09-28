import type { PGlite } from '@electric-sql/pglite'
import type { CalendarDate } from '@ghar/core/dates'
import { invitationExpiresAt } from '@ghar/core/invitations'
import {
  acceptInvitation,
  createHealthMedicine,
  createHousehold,
  createInvitation,
  createPerson,
  refillHealthMedicine,
  requireOwnPerson,
  stopHealthMedicine,
  type Db,
  type RequestContext,
} from '@ghar/db/queries'
import { beforeAll, describe, expect, it } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { runRefillReminders } from '@/lib/health/refill-reminders'
import { createMemoryProvider, EmailDeliveryError, type EmailProvider } from '@/lib/providers/email'

// The refill reminder job against a real schema, with an in-memory inbox.

let client: PGlite
let db: Db

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
})

let households = 0

/** Each test gets its own household with an owner, a member and a child, and reminds only that. */
async function household() {
  households += 1
  const n = String(households)
  const ownerEmail = `refill-owner-${n}@example.com`
  const ownerId = await createAuthUser(client, ownerEmail)
  const { household: row } = await createHousehold({ userId: ownerId, email: ownerEmail }, db, {
    name: `Household ${n}`,
    timezone: 'America/New_York',
    currency: 'USD',
  })
  const owner: RequestContext = { userId: ownerId, householdId: row.id, role: 'owner' }
  const memberEmail = `refill-member-${n}@example.com`
  const memberId = await createAuthUser(client, memberEmail)
  await createInvitation(owner, db, {
    email: memberEmail,
    role: 'member',
    tokenHash: `hash-${memberEmail}`,
    expiresAt: invitationExpiresAt(new Date()),
  })
  await acceptInvitation({ userId: memberId, email: memberEmail }, db, { tokenHash: `hash-${memberEmail}`, now: new Date() })
  const member: RequestContext = { userId: memberId, householdId: row.id, role: 'member' }
  const child = (await createPerson(owner, db, { name: 'Anika' }, '2026-09-28')).id
  return { owner, ownerEmail, member, memberEmail, memberPerson: await requireOwnPerson(member, db), child }
}

function medicine(ctx: RequestContext, personId: string, name: string, refillBy: CalendarDate) {
  return createHealthMedicine(
    ctx,
    db,
    { personId, name, dose: '5 mg', contactId: null, startedOn: null, stoppedOn: null, refillBy, supplyDays: 30, note: null },
    '2026-09-01'
  )
}

/** Runs the job at 11am New York time on `today`. */
function run(ctx: RequestContext, email: EmailProvider, today: CalendarDate) {
  return runRefillReminders(
    { db, email, appUrl: 'https://ghar.test', now: new Date(`${today}T15:00:00Z`) },
    { householdId: ctx.householdId }
  )
}

describe('refill reminders', () => {
  it('reminds once a week ahead, the adults and the person themselves, and never about the dose', async () => {
    const { owner, ownerEmail, member, memberEmail, memberPerson, child } = await household()
    await medicine(owner, child, 'Cetirizine', '2026-10-14')
    await medicine(member, memberPerson, 'Metformin', '2026-10-14')

    const early = createMemoryProvider()
    expect(await run(owner, early, '2026-10-06')).toMatchObject({ medicines: 0, reminded: 0 })

    const week = createMemoryProvider()
    expect(await run(owner, week, '2026-10-07')).toMatchObject({ reminded: 2, emails: 3, errors: 0 })
    const bySubject = week.sent.map(message => [message.to, message.subject])
    expect(bySubject).toContainEqual([ownerEmail, 'Refill Cetirizine for Anika by Oct 14'])
    expect(bySubject).toContainEqual([memberEmail, 'Refill Metformin by Oct 14'])
    expect(week.sent.filter(message => message.to === memberEmail)).toHaveLength(1)
    expect(week.sent.every(message => !message.text.includes('5 mg'))).toBe(true)

    const again = createMemoryProvider()
    expect(await run(owner, again, '2026-10-10')).toMatchObject({ reminded: 0, skipped: 2 })
    expect(again.sent).toEqual([])
  })

  it('starts over once refilled, and never reminds about a stopped one', async () => {
    const { owner, child } = await household()
    const current = await medicine(owner, child, 'Cetirizine', '2026-10-14')
    const stopped = await medicine(owner, child, 'Amoxicillin', '2026-10-14')
    await stopHealthMedicine(owner, db, stopped.id, '2026-10-01')

    const first = createMemoryProvider()
    await run(owner, first, '2026-10-07')
    expect(first.sent.map(message => message.subject)).toEqual(['Refill Cetirizine for Anika by Oct 14'])

    // Refilled on the 12th: next due November 11.
    await refillHealthMedicine(owner, db, current.id, '2026-10-12')
    const next = createMemoryProvider()
    await run(owner, next, '2026-11-04')
    expect(next.sent.map(message => message.subject)).toEqual(['Refill Cetirizine for Anika by Nov 11'])
  })

  it('gives the reminder back when the email fails, so the next run sends it', async () => {
    const { owner, child } = await household()
    await medicine(owner, child, 'Cetirizine', '2026-09-14')
    const down: EmailProvider = { send: () => Promise.reject(new EmailDeliveryError('Resend is down')) }

    expect(await run(owner, down, '2026-09-14')).toMatchObject({ reminded: 0, errors: 1 })

    const inbox = createMemoryProvider()
    expect(await run(owner, inbox, '2026-09-14')).toMatchObject({ reminded: 1, errors: 0 })
    expect(inbox.sent.map(message => message.subject)).toEqual(['Refill Cetirizine for Anika today'])
  })
})
