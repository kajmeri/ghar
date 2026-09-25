import type { PGlite } from '@electric-sql/pglite'
import type { CalendarDate } from '@ghar/core/dates'
import { invitationExpiresAt } from '@ghar/core/invitations'
import {
  acceptInvitation,
  createHealthEvent,
  createHealthSchedule,
  createHousehold,
  createInvitation,
  createPerson,
  requireOwnPerson,
  type Db,
  type RequestContext,
} from '@ghar/db/queries'
import { beforeAll, describe, expect, it } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { runHealthReminders } from '@/lib/health/reminders'
import { createMemoryProvider, EmailDeliveryError, type EmailProvider } from '@/lib/providers/email'

// The health reminder job against a real schema, with an in-memory inbox.

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
  const ownerEmail = `health-owner-${n}@example.com`
  const ownerId = await createAuthUser(client, ownerEmail)
  const { household: row } = await createHousehold({ userId: ownerId, email: ownerEmail }, db, {
    name: `Household ${n}`,
    timezone: 'America/New_York',
    currency: 'USD',
  })
  const owner: RequestContext = { userId: ownerId, householdId: row.id, role: 'owner' }
  const memberEmail = `health-member-${n}@example.com`
  const memberId = await createAuthUser(client, memberEmail)
  await createInvitation(owner, db, {
    email: memberEmail,
    role: 'member',
    tokenHash: `hash-${memberEmail}`,
    expiresAt: invitationExpiresAt(new Date()),
  })
  await acceptInvitation({ userId: memberId, email: memberEmail }, db, { tokenHash: `hash-${memberEmail}`, now: new Date() })
  const member: RequestContext = { userId: memberId, householdId: row.id, role: 'member' }
  const child = (await createPerson(owner, db, { name: 'Anika' })).id
  return { owner, ownerEmail, member, memberEmail, memberPerson: await requireOwnPerson(member, db), child }
}

function schedule(ctx: RequestContext, personId: string, firstDueOn: CalendarDate) {
  return createHealthSchedule(ctx, db, { personId, kind: 'dental', title: null, cadenceMonths: 6, firstDueOn }, '2026-09-01')
}

/** Runs the job at 11am New York time on `today`. */
function run(ctx: RequestContext, email: EmailProvider, today: CalendarDate) {
  return runHealthReminders(
    { db, email, appUrl: 'https://ghar.test', now: new Date(`${today}T15:00:00Z`) },
    { householdId: ctx.householdId }
  )
}

describe('health reminders', () => {
  it('reminds at 30 and 7 days, once each, the adults and the person themselves', async () => {
    const { owner, ownerEmail, member, memberEmail, memberPerson, child } = await household()
    await schedule(owner, child, '2026-10-14')
    await schedule(member, memberPerson, '2026-10-14')

    const first = createMemoryProvider()
    expect(await run(owner, first, '2026-09-14')).toMatchObject({ reminded: 2, emails: 3, errors: 0 })
    const bySubject = first.sent.map(message => [message.to, message.subject])
    expect(bySubject).toContainEqual([ownerEmail, 'Dentist for Anika due in 30 days'])
    expect(bySubject).toContainEqual([memberEmail, 'Dentist due in 30 days'])
    // Another member's checkups aren't theirs to hear about.
    expect(first.sent.filter(message => message.to === memberEmail)).toHaveLength(1)
    expect(first.sent.find(message => message.to === ownerEmail && message.subject.includes('Anika'))?.text).toContain(
      `https://ghar.test/health?person=${child}`
    )

    const again = createMemoryProvider()
    expect(await run(owner, again, '2026-09-20')).toMatchObject({ reminded: 0, skipped: 2 })
    expect(again.sent).toEqual([])

    const week = createMemoryProvider()
    expect(await run(owner, week, '2026-10-08')).toMatchObject({ reminded: 2 })
    expect(week.sent.map(message => message.subject)).toContain('Dentist for Anika due in 6 days')

    // Past the date, Home and the digest carry it. No more emails.
    const late = createMemoryProvider()
    await run(owner, late, '2026-10-20')
    expect(late.sent).toEqual([])
  })

  it('starts over when the visit is logged', async () => {
    const { owner, child } = await household()
    await schedule(owner, child, '2026-10-14')
    await run(owner, createMemoryProvider(), '2026-09-14')

    await createHealthEvent(
      owner,
      db,
      { personId: child, kind: 'dental', title: 'Cleaning', occurredOn: '2026-09-20', contactId: null, documentId: null, note: null },
      '2026-09-20'
    )
    // Due on March 20 now, so nothing until 30 days before.
    const inbox = createMemoryProvider()
    expect(await run(owner, inbox, '2026-10-07')).toMatchObject({ schedules: 0, reminded: 0 })
    await run(owner, inbox, '2027-02-18')
    expect(inbox.sent.map(message => message.subject)).toEqual(['Dentist for Anika due in 30 days'])
  })

  it('gives the reminder back when the email fails, so the next run sends it', async () => {
    const { owner, child } = await household()
    await schedule(owner, child, '2026-09-21')
    const down: EmailProvider = { send: () => Promise.reject(new EmailDeliveryError('Resend is down')) }

    expect(await run(owner, down, '2026-09-14')).toMatchObject({ reminded: 0, errors: 1 })

    const inbox = createMemoryProvider()
    expect(await run(owner, inbox, '2026-09-14')).toMatchObject({ reminded: 1, errors: 0 })
    expect(inbox.sent.map(message => message.subject)).toEqual(['Dentist for Anika due in 7 days'])
  })
})
