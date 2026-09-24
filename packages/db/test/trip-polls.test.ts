import type { PGlite } from '@electric-sql/pglite'
import type { RequestContext } from '@ghar/contracts'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@ghar/core/errors'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { nudgesDue } from '@ghar/core/trip-polls'
import { beforeAll, describe, expect, it } from 'vitest'
import { claimDecisionNudge, listTripsForNudges, releaseDecisionNudges } from '../src/queries/decision-nudges'
import { createInvitation } from '../src/queries/invitations'
import { chooseOption, createOption, createSlot, listItinerary, voteOnOption } from '../src/queries/itinerary'
import { acceptInvitation, createHousehold, updateProfile } from '../src/queries/session'
import {
  deleteSharedOption,
  inviteTripGuests,
  respondToTripInvite,
  suggestSharedOption,
  voteOnSharedOption,
} from '../src/queries/trip-guests'
import {
  addTripPollOption,
  deleteTripPoll,
  deleteTripPollOption,
  listTripPolls,
  openTripPoll,
  pickTripPollOption,
  setTripPollDecideBy,
  voteOnTripPollOption,
} from '../src/queries/trip-polls'
import { createTrip, getTripWithCounts } from '../src/queries/trips'
import type { Db, SessionContext, SystemContext } from '../src/queries/types'
import { createAuthUser, createTestDatabase, queryAs } from './support/database'

const now = new Date('2026-09-24T15:00:00Z')

let client: PGlite
let db: Db
let a: RequestContext
let owner: SessionContext
let viewer: SessionContext
let stranger: SessionContext
let sam: SessionContext
let tripId: string

async function person(email: string, fullName: string | null = null): Promise<SessionContext> {
  const session = { userId: await createAuthUser(client, email), email }
  if (fullName) await updateProfile(session, db, { fullName })
  return session
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  owner = await person('owner@example.com', 'Asha Mehta')
  const household = await createHousehold(owner, db, { name: 'The Mehtas', timezone: 'UTC', currency: 'USD' })
  a = { userId: owner.userId, householdId: household.household.id, role: 'owner' }

  viewer = await person('viewer@example.com', 'Vik Mehta')
  await createInvitation(a, db, {
    email: 'viewer@example.com',
    role: 'viewer',
    tokenHash: 'hash-viewer',
    expiresAt: invitationExpiresAt(now),
  })
  await acceptInvitation(viewer, db, { tokenHash: 'hash-viewer', now })

  stranger = await person('stranger@example.com')
  await createHousehold(stranger, db, { name: 'Someone else', timezone: 'UTC', currency: 'USD' })

  const trip = await createTrip(a, db, {
    name: 'Somewhere warm',
    destination: null,
    startsOn: null,
    endsOn: null,
    status: 'idea',
    coverImageUrl: null,
    budgetCents: null,
    notes: null,
    travellerIds: [],
  })
  tripId = trip.id

  await inviteTripGuests(a, db, { tripId, invites: [{ email: 'sam@example.com', tokenHash: 'hash-sam' }], now })
  sam = await person('sam@example.com', 'Sam Rao')
  await respondToTripInvite(sam, db, { tokenHash: 'hash-sam', response: 'maybe', partySize: 1, now })
})

describe('when works', () => {
  let pollId: string

  it('is opened by the household, once', async () => {
    const value = await openTripPoll(owner, db, tripId, { kind: 'dates', decideBy: '2026-10-01', now })
    expect(value).toMatchObject({ canVote: true, canManage: true, polls: [{ kind: 'dates', title: 'When works?', options: [] }] })
    pollId = value.polls[0]?.id ?? ''
    await expect(openTripPoll(owner, db, tripId, { kind: 'dates', decideBy: null, now })).rejects.toThrow(ConflictError)
    await expect(openTripPoll(sam, db, tripId, { kind: 'place', decideBy: null, now })).rejects.toThrow(ForbiddenError)
    await expect(openTripPoll(owner, db, tripId, { kind: 'place', decideBy: '2026-09-01', now })).rejects.toThrow(ValidationError)
  })

  it('is seen by the household and guests, and nobody else', async () => {
    expect(await listTripPolls(sam, db, tripId)).toMatchObject({ canVote: true, canManage: false })
    expect(await listTripPolls(viewer, db, tripId)).toMatchObject({ canVote: false, canManage: false })
    await expect(listTripPolls(stranger, db, tripId)).rejects.toThrow(NotFoundError)
  })

  it('takes options from anyone who can vote, without repeats', async () => {
    await addTripPollOption(owner, db, { tripId, pollId, option: { startsOn: '2026-12-20', endsOn: '2026-12-27' }, now })
    const value = await addTripPollOption(sam, db, { tripId, pollId, option: { startsOn: '2027-01-02', endsOn: '2027-01-06' }, now })
    expect(value.polls[0]?.options.map(option => [option.startsOn, option.addedBy, option.canDelete])).toEqual([
      ['2026-12-20', 'Asha', false],
      ['2027-01-02', 'Sam', true],
    ])
    await expect(
      addTripPollOption(sam, db, { tripId, pollId, option: { startsOn: '2026-12-20', endsOn: '2026-12-27' }, now })
    ).rejects.toThrow(ConflictError)
    await expect(addTripPollOption(sam, db, { tripId, pollId, option: { label: 'Goa' }, now })).rejects.toThrow(ValidationError)
    await expect(
      addTripPollOption(viewer, db, { tripId, pollId, option: { startsOn: '2027-02-01', endsOn: '2027-02-03' }, now })
    ).rejects.toThrow(ForbiddenError)
  })

  it('counts votes, shows each their own, and finds who is ahead', async () => {
    const [december, january] = (await listTripPolls(owner, db, tripId)).polls[0]?.options ?? []
    if (!december || !january) throw new Error('Expected two options')
    await voteOnTripPollOption(owner, db, { tripId, pollId, optionId: december.id, vote: 'yes' })
    await voteOnTripPollOption(sam, db, { tripId, pollId, optionId: december.id, vote: 'yes' })
    await voteOnTripPollOption(sam, db, { tripId, pollId, optionId: january.id, vote: 'no' })
    const asSam = await voteOnTripPollOption(sam, db, { tripId, pollId, optionId: january.id, vote: 'maybe' })
    expect(asSam.polls[0]).toMatchObject({
      leaderId: december.id,
      voters: 2,
      options: [
        { yes: 2, maybe: 0, no: 0, myVote: 'yes' },
        { yes: 0, maybe: 1, no: 0, myVote: 'maybe' },
      ],
    })
    await voteOnTripPollOption(sam, db, { tripId, pollId, optionId: january.id, vote: null })
    expect((await listTripPolls(sam, db, tripId)).polls[0]?.options[1]?.myVote).toBeNull()
    await expect(voteOnTripPollOption(viewer, db, { tripId, pollId, optionId: january.id, vote: 'yes' })).rejects.toThrow(ForbiddenError)
  })

  it('lets a guest take back only what they added', async () => {
    const [december, january] = (await listTripPolls(sam, db, tripId)).polls[0]?.options ?? []
    if (!december || !january) throw new Error('Expected two options')
    await expect(deleteTripPollOption(sam, db, { tripId, pollId, optionId: december.id })).rejects.toThrow(ForbiddenError)
    const value = await deleteTripPollOption(sam, db, { tripId, pollId, optionId: january.id })
    expect(value.polls[0]?.options).toHaveLength(1)
  })

  it('is readable in the database by people on the trip only', async () => {
    expect(await queryAs(client, sam.userId, 'select id from trip_polls')).toHaveLength(1)
    expect(await queryAs(client, sam.userId, 'select id from trip_poll_options')).toHaveLength(1)
    expect(await queryAs(client, viewer.userId, 'select option_id from trip_poll_votes')).toHaveLength(2)
    expect(await queryAs(client, stranger.userId, 'select id from trip_polls')).toHaveLength(0)
    expect(await queryAs(client, owner.userId, 'select id from decision_nudges')).toHaveLength(0)
  })

  it('becomes the trip’s dates when the household picks', async () => {
    const [december] = (await listTripPolls(owner, db, tripId)).polls[0]?.options ?? []
    if (!december) throw new Error('Expected an option')
    await expect(pickTripPollOption(sam, db, { tripId, pollId, optionId: december.id })).rejects.toThrow(ForbiddenError)
    const value = await pickTripPollOption(owner, db, { tripId, pollId, optionId: december.id })
    expect(value.polls).toEqual([])
    expect(await getTripWithCounts(a, db, tripId)).toMatchObject({ startsOn: '2026-12-20', endsOn: '2026-12-27' })
  })
})

describe('where to', () => {
  it('becomes the destination when picked, and can be closed without picking', async () => {
    const opened = await openTripPoll(owner, db, tripId, { kind: 'place', decideBy: null, now })
    const pollId = opened.polls[0]?.id ?? ''
    await addTripPollOption(sam, db, { tripId, pollId, option: { label: '  North   Goa ' }, now })
    await expect(addTripPollOption(owner, db, { tripId, pollId, option: { label: 'north goa' }, now })).rejects.toThrow(ConflictError)
    const withDate = await setTripPollDecideBy(owner, db, { tripId, pollId, decideBy: '2026-10-10', now })
    expect(withDate.polls[0]).toMatchObject({ decideBy: '2026-10-10', options: [{ label: 'North Goa' }] })
    const optionId = withDate.polls[0]?.options[0]?.id ?? ''
    await pickTripPollOption(owner, db, { tripId, pollId, optionId })
    expect((await getTripWithCounts(a, db, tripId)).destination).toBe('North Goa')

    const again = await openTripPoll(owner, db, tripId, { kind: 'place', decideBy: null, now })
    await expect(deleteTripPoll(sam, db, { tripId, pollId: again.polls[0]?.id ?? '' })).rejects.toThrow(ForbiddenError)
    expect((await deleteTripPoll(owner, db, { tripId, pollId: again.polls[0]?.id ?? '' })).polls).toEqual([])
  })
})

describe('guests on what’s being decided', () => {
  let slotId: string
  let palolem: string

  beforeAll(async () => {
    const slot = await createSlot(a, db, tripId, {
      day: '2026-12-21',
      band: 'afternoon',
      kind: 'activity',
      label: 'Beach',
      startsAt: null,
      endsAt: null,
      decideBy: '2026-09-25',
      notes: null,
    })
    slotId = slot.id
    const withOption = await createOption(a, db, tripId, slotId, { title: 'Palolem', costCents: 5_000 })
    palolem = withOption.options[0]?.id ?? ''
    await voteOnOption(a, db, tripId, palolem, { vote: 'yes' })
  })

  it('shows the choices and votes, never costs', async () => {
    const trip = await voteOnSharedOption(sam, db, { tripId, optionId: palolem, vote: 'maybe' })
    const beach = trip.itinerary.flatMap(day => day.slots).find(slot => slot.id === slotId)
    expect(beach).toMatchObject({
      state: 'deciding',
      decideBy: '2026-09-25',
      choices: [{ title: 'Palolem', addedBy: null, mine: false, yes: 1, maybe: 1, no: 0, myVote: 'maybe' }],
    })
    expect(JSON.stringify(trip)).not.toContain('5000')
  })

  it('takes a guest’s suggestion, and lets only them take it back', async () => {
    const trip = await suggestSharedOption(sam, db, {
      tripId,
      slotId,
      suggestion: { title: 'Agonda', subtitle: null, address: null, url: 'https://example.com/agonda' },
    })
    const choices = trip.itinerary.flatMap(day => day.slots).find(slot => slot.id === slotId)?.choices ?? []
    expect(choices.map(choice => [choice.title, choice.addedBy, choice.mine])).toEqual([
      ['Palolem', null, false],
      ['Agonda', 'Sam', true],
    ])
    // The household sees it among the options, and the guest's vote with the rest.
    const hostSlot = (await listItinerary(a, db, tripId)).slots.find(slot => slot.id === slotId)
    expect(hostSlot?.options.map(option => option.title)).toEqual(['Palolem', 'Agonda'])

    await expect(deleteSharedOption(sam, db, { tripId, optionId: palolem })).rejects.toThrow(ForbiddenError)
    const agonda = choices[1]?.id ?? ''
    const after = await deleteSharedOption(sam, db, { tripId, optionId: agonda })
    expect(after.itinerary.flatMap(day => day.slots).find(slot => slot.id === slotId)?.choices).toHaveLength(1)
  })

  it('stops once it’s decided', async () => {
    await chooseOption(a, db, tripId, palolem)
    await expect(voteOnSharedOption(sam, db, { tripId, optionId: palolem, vote: 'yes' })).rejects.toThrow(ConflictError)
    await expect(
      suggestSharedOption(sam, db, { tripId, slotId, suggestion: { title: 'Cola', subtitle: null, address: null, url: null } })
    ).rejects.toThrow(ConflictError)
  })

  it('is only for guests', async () => {
    await expect(voteOnSharedOption(stranger, db, { tripId, optionId: palolem, vote: 'yes' })).rejects.toThrow(NotFoundError)
    await expect(voteOnSharedOption(owner, db, { tripId, optionId: palolem, vote: 'yes' })).rejects.toThrow(NotFoundError)
  })
})

describe('nudges', () => {
  it('lists what’s due with who can vote, and claims each reminder once', async () => {
    const actor: SystemContext = { householdId: a.householdId, userId: null }
    const slot = await createSlot(a, db, tripId, {
      day: '2026-12-22',
      band: 'evening',
      kind: 'meal',
      label: 'Dinner',
      startsAt: null,
      endsAt: null,
      decideBy: '2026-09-25',
      notes: null,
    })
    const option = await createOption(a, db, tripId, slot.id, { title: 'Martin’s Corner' })
    await voteOnOption(a, db, tripId, option.options[0]?.id ?? '', { vote: 'yes' })

    const [trip] = await listTripsForNudges(actor, db, { today: '2026-09-24' })
    const dinner = trip?.subjects.find(subject => subject.id === slot.id)
    expect(dinner).toMatchObject({ kind: 'slot', label: 'Dinner', deadline: '2026-09-25', optionCount: 1 })
    expect(trip?.voters.map(voter => [voter.email, voter.access])).toEqual([
      ['owner@example.com', 'household'],
      ['sam@example.com', 'guest'],
    ])
    if (!trip || !dinner) throw new Error('Expected the dinner to be due')
    const due = nudgesDue({
      subjects: [dinner],
      voterIds: trip.voters.map(voter => voter.userId),
      nudged: trip.nudged,
      timeZone: 'UTC',
      now,
    })
    // The owner voted already.
    expect([...due.keys()]).toEqual([sam.userId])

    const claim = { userId: sam.userId, kind: 'slot' as const, subjectId: slot.id, deadline: '2026-09-25' }
    const id = await claimDecisionNudge(actor, db, claim)
    expect(id).not.toBeNull()
    expect(await claimDecisionNudge(actor, db, claim)).toBeNull()
    const [again] = await listTripsForNudges(actor, db, { today: '2026-09-24' })
    expect(again?.nudged.has(`slot:${slot.id}|${sam.userId}`)).toBe(true)
    await releaseDecisionNudges(actor, db, [id ?? ''])
    expect(await claimDecisionNudge(actor, db, claim)).not.toBeNull()
  })
})
