import type { PGlite } from '@electric-sql/pglite'
import type { RequestContext } from '@ghar/contracts'
import { ForbiddenError, NotFoundError, ValidationError } from '@ghar/core/errors'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { HOUSEHOLD_PARTY, type TripParty } from '@ghar/core/trip-costs'
import { tripPhotoStoragePath } from '@ghar/core/trip-photos'
import { beforeAll, describe, expect, it } from 'vitest'
import { createInvitation } from '../src/queries/invitations'
import { createPerson } from '../src/queries/people'
import { acceptInvitation, createHousehold, updateProfile } from '../src/queries/session'
import { createTripCost, listTripCosts } from '../src/queries/trip-costs'
import { inviteTripGuests, respondToTripInvite } from '../src/queries/trip-guests'
import { addTripPhoto, authorizeTripPhotoUpload, deleteTripPhoto, listTripPhotos, type TripPhotoInput } from '../src/queries/trip-photos'
import { claimTripRecap, getTripRecap, listTripsDueRecap, releaseTripRecap } from '../src/queries/trip-recap'
import { setTripUpdatesMuted } from '../src/queries/trip-updates'
import { createTrip, deleteTrip } from '../src/queries/trips'
import type { Db, SessionContext } from '../src/queries/types'
import { createAuthUser, createTestDatabase, queryAs } from './support/database'

const now = new Date('2026-09-24T15:00:00Z')
const today = '2026-09-24'

let client: PGlite
let db: Db
let a: RequestContext
let owner: SessionContext
let viewer: SessionContext
let stranger: SessionContext
let sam: SessionContext
let tripId: string
let soloTripId: string
let samParty: TripParty
let objects = 0

async function person(email: string, fullName: string | null = null): Promise<SessionContext> {
  const session = { userId: await createAuthUser(client, email), email }
  if (fullName) await updateProfile(session, db, { fullName })
  return session
}

function photo(overrides: Partial<TripPhotoInput> = {}): TripPhotoInput {
  objects += 1
  const objectId = `00000000-0000-4000-8000-${String(objects).padStart(12, '0')}`
  return {
    tripId,
    storagePath: tripPhotoStoragePath(overrides.tripId ?? tripId, objectId, 'image/jpeg'),
    mimeType: 'image/jpeg',
    sizeBytes: 420_000,
    caption: null,
    ...overrides,
  }
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  owner = await person('owner@example.com', 'Asha Mehta')
  const household = await createHousehold(owner, db, { name: 'The Mehtas', timezone: 'Europe/Lisbon', currency: 'EUR' })
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

  const kid = await createPerson(a, db, { name: 'Mira' }, '2026-09-28')
  const base = { destination: 'Lisbon', status: 'booked' as const, coverImageUrl: null, budgetCents: null, notes: null }
  tripId = (await createTrip(a, db, { ...base, name: 'Lisbon', startsOn: '2026-09-18', endsOn: '2026-09-21', travellerIds: [kid.id] })).id
  soloTripId = (await createTrip(a, db, { ...base, name: 'Porto', startsOn: '2026-09-20', endsOn: '2026-09-22', travellerIds: [] })).id

  await inviteTripGuests(a, db, { tripId, invites: [{ email: 'sam@example.com', tokenHash: 'hash-sam' }], now })
  sam = await person('sam@example.com', 'Sam Rao')
  await respondToTripInvite(sam, db, { tokenHash: 'hash-sam', response: 'going', partySize: 2, now })
  const you = (await listTripCosts(sam, db, tripId)).you
  samParty = you
})

describe('the trip album', () => {
  it('starts empty, and only people on the trip can add to it', async () => {
    expect(await listTripPhotos(sam, db, tripId)).toMatchObject({ photos: [], canAdd: true, room: 500 })
    expect(await listTripPhotos(viewer, db, tripId)).toMatchObject({ canAdd: false })
    await authorizeTripPhotoUpload(sam, db, tripId)
    await expect(authorizeTripPhotoUpload(viewer, db, tripId)).rejects.toThrow(ForbiddenError)
    await expect(authorizeTripPhotoUpload(stranger, db, tripId)).rejects.toThrow(NotFoundError)
    await expect(listTripPhotos(stranger, db, tripId)).rejects.toThrow(NotFoundError)
  })

  it('takes photos from the household and guests, newest first, with who added them', async () => {
    await addTripPhoto(owner, db, photo({ caption: '  First   night  ' }))
    const view = await addTripPhoto(sam, db, photo())
    expect(view.photos.map(row => [row.addedBy, row.caption, row.mine, row.canDelete])).toEqual([
      ['Sam', null, true, true],
      ['Asha', 'First night', false, false],
    ])
    expect(view.room).toBe(498)
    const forOwner = await listTripPhotos(owner, db, tripId)
    expect(forOwner.photos.every(row => row.canDelete)).toBe(true)
  })

  it('refuses a file for another trip, an odd type or a long caption, and keeps one of a file saved twice', async () => {
    const elsewhere = photo({ tripId: soloTripId })
    await expect(addTripPhoto(sam, db, { ...elsewhere, tripId })).rejects.toThrow(ValidationError)
    await expect(addTripPhoto(sam, db, { ...photo(), storagePath: 'households/x/y.jpg' })).rejects.toThrow(ValidationError)
    await expect(addTripPhoto(sam, db, { ...photo(), mimeType: 'image/gif' as never })).rejects.toThrow(ValidationError)
    await expect(addTripPhoto(sam, db, photo({ caption: 'x'.repeat(141) }))).rejects.toThrow(ValidationError)
    await expect(addTripPhoto(sam, db, photo({ sizeBytes: 0 }))).rejects.toThrow(ValidationError)
    await expect(addTripPhoto(viewer, db, photo())).rejects.toThrow(ForbiddenError)
    const once = photo()
    const before = (await addTripPhoto(sam, db, once)).photos.length
    expect((await addTripPhoto(sam, db, once)).photos).toHaveLength(before)
  })

  it('refuses a row pointing at another trip even past the queries', async () => {
    const stray = photo({ tripId: soloTripId })
    await expect(
      client.query('insert into trip_photos (trip_id, storage_path, mime_type, size_bytes) values ($1, $2, $3, $4)', [
        tripId,
        stray.storagePath,
        'image/jpeg',
        10,
      ])
    ).rejects.toThrow()
  })

  it('lets whoever added a photo take it down, and the household take down any', async () => {
    const { photos } = await listTripPhotos(owner, db, tripId)
    const ashas = photos.find(row => row.addedBy === 'Asha')
    const sams = photos.find(row => row.addedBy === 'Sam')
    if (!ashas || !sams) throw new Error('missing photos')
    await expect(deleteTripPhoto(sam, db, { tripId, photoId: ashas.id })).rejects.toThrow(ForbiddenError)
    await expect(deleteTripPhoto(viewer, db, { tripId, photoId: sams.id })).rejects.toThrow(ForbiddenError)
    const gone = await deleteTripPhoto(sam, db, { tripId, photoId: sams.id })
    expect(gone.storagePath).toBe(sams.storagePath)
    await expect(deleteTripPhoto(owner, db, { tripId, photoId: sams.id })).rejects.toThrow(NotFoundError)
  })

  it('is readable through RLS by people on the trip only', async () => {
    expect((await queryAs(client, sam.userId, 'select id from trip_photos')).length).toBeGreaterThan(0)
    expect((await queryAs(client, viewer.userId, 'select id from trip_photos')).length).toBeGreaterThan(0)
    expect(await queryAs(client, stranger.userId, 'select id from trip_photos')).toHaveLength(0)
    expect(await queryAs(client, sam.userId, 'select trip_id from trip_recap_emails')).toHaveLength(0)
  })
})

describe('the recap', () => {
  it('sums up the trip', async () => {
    const slots = await client.query<{ id: string }>(
      `insert into itinerary_slots (trip_id, day, band, kind, label) values
        ($1, '2026-09-18', 'evening', 'meal', 'Dinner'),
        ($1, '2026-09-19', 'morning', 'activity', 'Tram 28'),
        ($1, '2026-09-19', 'afternoon', 'activity', 'Maybe a museum')
       returning id`,
      [tripId]
    )
    for (const [index, status] of ['decided', 'booked'].entries()) {
      const slotId = slots.rows[index]?.id
      const option = await client.query<{ id: string }>(`insert into itinerary_options (slot_id, title) values ($1, 'Pick') returning id`, [
        slotId,
      ])
      await client.query('update itinerary_slots set status = $2, chosen_option_id = $3 where id = $1', [
        slotId,
        status,
        option.rows[0]?.id,
      ])
    }
    await createTripCost(owner, db, {
      tripId,
      description: 'Dinner',
      amountCents: 300_00,
      spentOn: '2026-09-18',
      paidBy: HOUSEHOLD_PARTY,
      shares: [
        { party: HOUSEHOLD_PARTY, shares: 1 },
        { party: samParty, shares: 1 },
      ],
    })
    const recap = await getTripRecap(sam, db, tripId)
    expect(recap).toMatchObject({
      people: 4,
      plans: 2,
      photos: 2,
      openTransfers: 1,
      totalCents: 300_00,
      currency: 'EUR',
      lines: ['3 nights', '4 people', '2 plans', '2 photos'],
    })
    await expect(getTripRecap(stranger, db, tripId)).rejects.toThrow(NotFoundError)
  })

  it('is emailed once, to everyone on a trip with guests, and can be given back', async () => {
    const system = { householdId: a.householdId, userId: null }
    expect(await listTripsDueRecap(system, db, today)).toEqual([tripId])
    expect(await listTripsDueRecap(system, db, '2026-09-21')).toEqual([])
    expect(await listTripsDueRecap(system, db, '2026-09-29')).toEqual([])
    await setTripUpdatesMuted(viewer, db, { tripId, muted: true })

    const email = await claimTripRecap(system, db, tripId)
    expect(email?.trip).toMatchObject({ name: 'Lisbon', householdName: 'The Mehtas' })
    expect(email?.recipients.map(row => [row.email, row.access])).toEqual([
      ['owner@example.com', 'household'],
      ['sam@example.com', 'guest'],
    ])
    expect(await claimTripRecap(system, db, tripId)).toBeNull()
    expect(await listTripsDueRecap(system, db, today)).toEqual([])

    await releaseTripRecap(system, db, tripId)
    expect(await listTripsDueRecap(system, db, today)).toEqual([tripId])
    const other = {
      householdId: (await client.query<{ id: string }>("select id from households where name = 'Someone else'")).rows[0]?.id ?? '',
      userId: null,
    }
    expect(await claimTripRecap(other, db, tripId)).toBeNull()
  })

  it('hands back the photo files when the trip is deleted', async () => {
    const { photoPaths } = await deleteTrip(a, db, tripId)
    expect(photoPaths).toHaveLength(2)
    expect((await client.query('select id from trip_photos')).rows).toHaveLength(0)
    expect((await client.query('select trip_id from trip_recap_emails')).rows).toHaveLength(0)
  })
})
