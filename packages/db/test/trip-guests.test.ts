import type { PGlite } from '@electric-sql/pglite'
import type { RequestContext } from '@ghar/contracts'
import { ConflictError, ForbiddenError, NotFoundError } from '@ghar/core/errors'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { beforeAll, describe, expect, it } from 'vitest'
import { createInvitation } from '../src/queries/invitations'
import { removeMember } from '../src/queries/members'
import { acceptInvitation, createHousehold, updateProfile } from '../src/queries/session'
import {
  approveTripGuest,
  countSharedTrips,
  createTripShareLink,
  deleteTripShareLink,
  findTripAccess,
  getSharedTrip,
  getTripShareLink,
  inviteTripGuests,
  listSharedTrips,
  listTripGuests,
  previewTripInvite,
  removeTripGuest,
  respondToTripInvite,
  setTripShareLinkApproval,
  updateMyTripAnswer,
} from '../src/queries/trip-guests'
import { createTrip } from '../src/queries/trips'
import type { Db, SessionContext } from '../src/queries/types'
import { createAuthUser, createTestDatabase, queryAs } from './support/database'

const now = new Date('2026-09-24T15:00:00Z')

let client: PGlite
let db: Db
let a: RequestContext
let memberA: RequestContext
let b: RequestContext
let tripId: string

async function person(email: string, fullName: string | null = null): Promise<SessionContext> {
  const session = { userId: await createAuthUser(client, email), email }
  if (fullName) await updateProfile(session, db, { fullName })
  return session
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  const ownerA = await person('owner-a@example.com', 'Asha Mehta')
  const householdA = await createHousehold(ownerA, db, { name: 'The Mehtas', timezone: 'America/Chicago', currency: 'USD' })
  a = { userId: ownerA.userId, householdId: householdA.household.id, role: 'owner' }

  const member = await person('member-a@example.com')
  await createInvitation(a, db, { email: member.email ?? '', role: 'member', tokenHash: 'hash-member-a', expiresAt: invitationExpiresAt(now) })
  await acceptInvitation(member, db, { tokenHash: 'hash-member-a', now })
  memberA = { userId: member.userId, householdId: a.householdId, role: 'member' }

  const ownerB = await person('owner-b@example.com')
  const householdB = await createHousehold(ownerB, db, { name: 'Household B', timezone: 'UTC', currency: 'USD' })
  b = { userId: ownerB.userId, householdId: householdB.household.id, role: 'owner' }

  const trip = await createTrip(a, db, {
    name: 'Goa in December',
    destination: 'Goa',
    startsOn: '2026-12-20',
    endsOn: '2026-12-27',
    status: 'planned',
    coverImageUrl: null,
    budgetCents: 400_000,
    notes: 'Villa code 4412',
    travellerIds: [],
  })
  tripId = trip.id
})

describe('asking people by email', () => {
  it('asks new addresses and skips the household and anyone already asked', async () => {
    const first = await inviteTripGuests(a, db, {
      tripId,
      invites: [
        { email: ' Sam@Example.com', tokenHash: 'hash-sam' },
        { email: 'member-a@example.com', tokenHash: 'hash-member' },
      ],
      now,
    })
    expect(first.invited.map(guest => [guest.email, guest.status])).toEqual([['sam@example.com', 'invited']])
    expect(first.skipped).toEqual([{ email: 'member-a@example.com', reason: 'in_household' }])

    const again = await inviteTripGuests(a, db, { tripId, invites: [{ email: 'sam@example.com', tokenHash: 'hash-sam-2' }], now })
    expect(again).toEqual({ invited: [], skipped: [{ email: 'sam@example.com', reason: 'already_invited' }] })
  })

  it('is for owners and adults, and only on their own trips', async () => {
    await expect(inviteTripGuests(memberA, db, { tripId, invites: [{ email: 'x@example.com', tokenHash: 'h-x' }], now })).rejects.toThrow(
      ForbiddenError
    )
    await expect(inviteTripGuests(b, db, { tripId, invites: [{ email: 'x@example.com', tokenHash: 'h-x' }], now })).rejects.toThrow(
      NotFoundError
    )
    await expect(listTripGuests(b, db, tripId)).rejects.toThrow(NotFoundError)
    // A member can still see who is coming.
    expect((await listTripGuests(memberA, db, tripId)).guests).toHaveLength(1)
  })
})

describe('the invitation page', () => {
  it('shows a stranger the trip and first names, and nothing private', async () => {
    const preview = await previewTripInvite(null, db, { tokenHash: 'hash-sam' })
    expect(preview).toMatchObject({
      kind: 'email',
      trip: { name: 'Goa in December', destination: 'Goa', startsOn: '2026-12-20', householdName: 'The Mehtas' },
      invitedByName: 'Asha',
      going: { names: ['Asha'], headcount: { going: 1, maybe: 0 } },
      invitedEmail: 'sam@example.com',
      forYou: false,
      inHousehold: false,
      mine: null,
    })
    expect(JSON.stringify(preview)).not.toContain('Villa code')
    expect(JSON.stringify(preview)).not.toContain('400000')
  })

  it('says nothing about a token it does not know', async () => {
    await expect(previewTripInvite(null, db, { tokenHash: 'nope' })).rejects.toThrow(NotFoundError)
  })
})

describe('someone with no household, over time', () => {
  let sam: SessionContext

  it('can only answer an emailed invitation as the address it went to', async () => {
    const stranger = await person('stranger@example.com')
    await expect(respondToTripInvite(stranger, db, { tokenHash: 'hash-sam', response: 'going', partySize: 1, now })).rejects.toThrow(
      ForbiddenError
    )
  })

  it('answers without a household and sees the trip', async () => {
    sam = await person('sam@example.com', 'Sam Iyer')
    const answer = await respondToTripInvite(sam, db, { tokenHash: 'hash-sam', response: 'going', partySize: 2, now })
    expect(answer).toMatchObject({ tripId, status: 'going', admitted: true })

    expect(await findTripAccess(sam, db, tripId)).toMatchObject({ access: 'guest', hostHouseholdId: a.householdId })
    expect((await listSharedTrips(sam, db)).map(trip => [trip.name, trip.householdName, trip.mine.status])).toEqual([
      ['Goa in December', 'The Mehtas', 'going'],
    ])
    const shared = await getSharedTrip(sam, db, tripId)
    expect(shared.going).toEqual({ names: ['Asha', 'Sam'], headcount: { going: 3, maybe: 0 } })
    expect(shared).not.toHaveProperty('budgetCents')
    expect(shared).not.toHaveProperty('notes')
  })

  it('keeps the trip after starting a household of their own', async () => {
    await createHousehold(sam, db, { name: 'The Iyers', timezone: 'Asia/Kolkata', currency: 'INR' })
    expect(await findTripAccess(sam, db, tripId)).toMatchObject({ access: 'guest' })
    expect(await countSharedTrips(sam, db)).toBe(1)
    expect((await listSharedTrips(sam, db)).map(trip => trip.id)).toEqual([tripId])
  })

  it('can change their answer', async () => {
    const answer = await updateMyTripAnswer(sam, db, { tripId, response: 'maybe', partySize: 3, now })
    expect(answer.status).toBe('maybe')
    expect((await listTripGuests(a, db, tripId)).headcount).toEqual({ going: 1, maybe: 3 })
  })

  it('cannot open trips it was never let onto', async () => {
    const other = await createTrip(b, db, {
      name: 'Private',
      destination: null,
      startsOn: null,
      endsOn: null,
      status: 'idea',
      coverImageUrl: null,
      budgetCents: null,
      notes: null,
      travellerIds: [],
    })
    expect(await findTripAccess(sam, db, other.id)).toBeNull()
    await expect(getSharedTrip(sam, db, other.id)).rejects.toThrow(NotFoundError)
    await expect(updateMyTripAnswer(sam, db, { tripId: other.id, response: 'going', partySize: 1, now })).rejects.toThrow(NotFoundError)
  })
})

describe('the trip link', () => {
  let jo: SessionContext

  it('is off until someone turns it on', async () => {
    expect(await getTripShareLink(a, db, tripId)).toBeNull()
    await expect(getTripShareLink(memberA, db, tripId)).rejects.toThrow(ForbiddenError)
    const link = await createTripShareLink(a, db, { tripId, tokenHash: 'link-1', tokenSealed: 'sealed-1' })
    expect(link).toMatchObject({ tokenSealed: 'sealed-1', requiresApproval: true })
  })

  it('does not name who else was asked', async () => {
    const preview = await previewTripInvite(null, db, { tokenHash: 'link-1' })
    expect(preview).toMatchObject({ kind: 'link', invitedEmail: null, requiresApproval: true, forYou: true })
  })

  it('puts someone who asks through it in a queue until the household lets them in', async () => {
    jo = await person('jo@example.com', 'Jo')
    const answer = await respondToTripInvite(jo, db, { tokenHash: 'link-1', response: 'going', partySize: 1, now })
    expect(answer).toMatchObject({ status: 'asked', admitted: false })
    expect(await findTripAccess(jo, db, tripId)).toBeNull()
    expect(await listSharedTrips(jo, db)).toEqual([])
    const waiting = (await listTripGuests(a, db, tripId)).guests[0]
    expect(waiting).toMatchObject({ email: 'jo@example.com', name: 'Jo', status: 'asked', source: 'link' })

    // Answering again through the link changes the answer, not the queue.
    await respondToTripInvite(jo, db, { tokenHash: 'link-1', response: 'maybe', partySize: 1, now })
    expect((await previewTripInvite(jo, db, { tokenHash: 'link-1' })).mine).toMatchObject({ response: 'maybe', status: 'asked' })

    await approveTripGuest(a, db, { tripId, guestId: waiting?.id ?? '', now })
    expect(await findTripAccess(jo, db, tripId)).toMatchObject({ access: 'guest' })
  })

  it('lets people straight in when the household says so', async () => {
    await setTripShareLinkApproval(a, db, { tripId, requiresApproval: false })
    const kai = await person('kai@example.com')
    expect(await respondToTripInvite(kai, db, { tokenHash: 'link-1', response: 'going', partySize: 1, now })).toMatchObject({
      admitted: true,
    })
  })

  it('gives someone who was also emailed the place they already had', async () => {
    await inviteTripGuests(a, db, { tripId, invites: [{ email: 'lee@example.com', tokenHash: 'hash-lee' }], now })
    const lee = await person('lee@example.com')
    await respondToTripInvite(lee, db, { tokenHash: 'link-1', response: 'going', partySize: 1, now })
    const rows = (await listTripGuests(a, db, tripId)).guests.filter(guest => guest.email === 'lee@example.com')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ source: 'email', userId: lee.userId, status: 'going' })
  })

  it('tells the household the trip is already theirs', async () => {
    const owner = { userId: a.userId, email: 'owner-a@example.com' }
    expect((await previewTripInvite(owner, db, { tokenHash: 'link-1' })).inHousehold).toBe(true)
    await expect(respondToTripInvite(owner, db, { tokenHash: 'link-1', response: 'going', partySize: 1, now })).rejects.toThrow(
      ConflictError
    )
  })

  it('stops working when replaced or turned off, and nobody already in is dropped', async () => {
    await createTripShareLink(a, db, { tripId, tokenHash: 'link-2', tokenSealed: 'sealed-2' })
    expect((await getTripShareLink(a, db, tripId))?.requiresApproval).toBe(false)
    await expect(previewTripInvite(null, db, { tokenHash: 'link-1' })).rejects.toThrow(NotFoundError)
    await deleteTripShareLink(a, db, tripId)
    await expect(previewTripInvite(null, db, { tokenHash: 'link-2' })).rejects.toThrow(NotFoundError)
    expect(await findTripAccess(jo, db, tripId)).toMatchObject({ access: 'guest' })
  })

  it('takes someone off the trip, and their emailed link with them', async () => {
    const lee = (await listTripGuests(a, db, tripId)).guests.find(guest => guest.email === 'lee@example.com')
    await removeTripGuest(a, db, { tripId, guestId: lee?.id ?? '' })
    await expect(previewTripInvite(null, db, { tokenHash: 'hash-lee' })).rejects.toThrow(NotFoundError)
    await expect(removeTripGuest(b, db, { tripId, guestId: lee?.id ?? '' })).rejects.toThrow(NotFoundError)
  })
})

describe('a guest who joins the host household, then leaves', () => {
  it('sees the trip as a member while in, and as a guest again after', async () => {
    const pat = await person('pat@example.com')
    await inviteTripGuests(a, db, { tripId, invites: [{ email: 'pat@example.com', tokenHash: 'hash-pat' }], now })
    await respondToTripInvite(pat, db, { tokenHash: 'hash-pat', response: 'going', partySize: 1, now })
    expect(await findTripAccess(pat, db, tripId)).toMatchObject({ access: 'guest' })

    await createInvitation(a, db, { email: 'pat@example.com', role: 'adult', tokenHash: 'hash-pat-join', expiresAt: invitationExpiresAt(now) })
    await acceptInvitation(pat, db, { tokenHash: 'hash-pat-join', now })
    expect(await findTripAccess(pat, db, tripId)).toMatchObject({ access: 'household', guestId: null })
    expect(await listSharedTrips(pat, db)).toEqual([])
    await expect(getSharedTrip(pat, db, tripId)).rejects.toThrow(NotFoundError)

    await removeMember(a, db, { userId: pat.userId })
    expect(await findTripAccess(pat, db, tripId)).toMatchObject({ access: 'guest' })
    expect((await listSharedTrips(pat, db)).map(trip => trip.id)).toEqual([tripId])
  })
})

describe('row level security', () => {
  it('shows a guest only their own place, and the link to nobody', async () => {
    const [samRow] = (await listTripGuests(a, db, tripId)).guests.filter(guest => guest.email === 'sam@example.com')
    const samRows = await queryAs<{ email: string }>(client, samRow?.userId ?? null, 'select email from trip_guests')
    expect(samRows.map(row => row.email)).toEqual(['sam@example.com'])

    const hostRows = await queryAs<{ email: string }>(client, a.userId, 'select email from trip_guests')
    expect(hostRows.length).toBeGreaterThan(1)
    expect(await queryAs(client, b.userId, 'select id from trip_guests')).toEqual([])
    expect(await queryAs(client, a.userId, 'select trip_id from trip_share_links')).toEqual([])
    expect(await queryAs(client, null, 'select id from trip_guests')).toEqual([])
  })
})
