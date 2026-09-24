import type { PGlite } from '@electric-sql/pglite'
import {
  addTripPollOption,
  createHousehold,
  createOption,
  createSlot,
  createTrip,
  inviteTripGuests,
  openTripPoll,
  respondToTripInvite,
  updateProfile,
  voteOnSharedOption,
  type Db,
  type RequestContext,
  type SessionContext,
} from '@ghar/db/queries'
import { beforeAll, describe, expect, it } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { runDecisionNudges } from '@/lib/travel/decision-nudges'
import { createMemoryProvider, EmailDeliveryError, type EmailProvider } from '@/lib/providers/email'

// The whole nudge job against a real schema, with an in-memory inbox.

const now = new Date('2026-09-24T15:00:00Z')

let client: PGlite
let db: Db
let a: RequestContext
let sam: SessionContext
let tripId: string
let slotOptionId: string

async function person(email: string, fullName: string): Promise<SessionContext> {
  const session = { userId: await createAuthUser(client, email), email }
  await updateProfile(session, db, { fullName })
  return session
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  const owner = await person('owner@example.com', 'Asha Mehta')
  const { household } = await createHousehold(owner, db, { name: 'The Mehtas', timezone: 'UTC', currency: 'USD' })
  a = { userId: owner.userId, householdId: household.id, role: 'owner' }
  const trip = await createTrip(a, db, {
    name: 'Goa in December',
    destination: 'Goa',
    startsOn: '2026-12-20',
    endsOn: '2026-12-27',
    status: 'planned',
    coverImageUrl: null,
    budgetCents: null,
    notes: null,
    travellerIds: [],
  })
  tripId = trip.id
  await inviteTripGuests(a, db, { tripId, invites: [{ email: 'sam@example.com', tokenHash: 'hash-sam' }], now })
  sam = await person('sam@example.com', 'Sam Rao')
  await respondToTripInvite(sam, db, { tokenHash: 'hash-sam', response: 'going', partySize: 1, now })

  const slot = await createSlot(a, db, tripId, {
    day: '2026-12-21',
    band: 'evening',
    kind: 'meal',
    label: 'Dinner',
    startsAt: null,
    endsAt: null,
    decideBy: '2026-09-25',
    notes: null,
  })
  slotOptionId = (await createOption(a, db, tripId, slot.id, { title: 'Martin’s Corner' })).options[0]?.id ?? ''
  // Far off: nobody hears about this one yet.
  await createSlot(a, db, tripId, {
    day: '2026-12-22',
    band: 'evening',
    kind: 'meal',
    label: 'Lunch',
    startsAt: null,
    endsAt: null,
    decideBy: '2026-11-01',
    notes: null,
  })
  const polls = await openTripPoll(owner, db, tripId, { kind: 'place', decideBy: '2026-09-25', now })
  await addTripPollOption(owner, db, { tripId, pollId: polls.polls[0]?.id ?? '', option: { label: 'North Goa' }, now })
})

function run(email: EmailProvider) {
  return runDecisionNudges({ db, email, appUrl: 'https://ghar.test', now }, { householdId: a.householdId })
}

function failing(): EmailProvider {
  return { send: () => Promise.reject(new EmailDeliveryError('Resend is down')) }
}

describe('decision nudges', () => {
  it('gives back its claims when the email fails, so tomorrow tries again', async () => {
    const result = await run(failing())
    expect(result).toMatchObject({ trips: 1, emails: 0, errors: 2 })
  })

  it('emails each person who can vote once, about what they haven’t voted on, with their own link', async () => {
    await voteOnSharedOption(sam, db, { tripId, optionId: slotOptionId, vote: 'yes' })
    const inbox = createMemoryProvider()
    expect(await run(inbox)).toMatchObject({ trips: 1, emails: 2, errors: 0 })

    const byAddress = new Map(inbox.sent.map(message => [message.to, message]))
    const owner = byAddress.get('owner@example.com')
    expect(owner?.subject).toBe('Have your say on Goa in December')
    expect(owner?.text).toContain('Dinner, Mon, Dec 21 (Deciding tomorrow)')
    expect(owner?.text).toContain('Where to? (Deciding tomorrow)')
    expect(owner?.text).toContain(`https://ghar.test/travel/${tripId}`)
    expect(owner?.text).not.toContain('Lunch')

    // Sam voted on dinner, so only the poll.
    const guest = byAddress.get('sam@example.com')
    expect(guest?.subject).toBe('Have your say: Where to?')
    expect(guest?.text).toContain(`https://ghar.test/shared/${tripId}`)
    expect(guest?.html).not.toContain('<script')

    const again = createMemoryProvider()
    expect(await run(again)).toMatchObject({ emails: 0 })
    expect(again.sent).toEqual([])
  })
})
