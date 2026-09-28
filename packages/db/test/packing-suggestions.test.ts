import type { PGlite } from '@electric-sql/pglite'
import type { RequestContext } from '@ghar/contracts'
import { ForbiddenError, NotFoundError } from '@ghar/core/errors'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { beforeAll, describe, expect, it } from 'vitest'
import { createInvitation } from '../src/queries/invitations'
import {
  addSuggestedPackingItems,
  createPackingItem,
  dismissPackingSuggestions,
  listDismissedSuggestionKeys,
  listPackingItems,
  restorePackingSuggestions,
  updatePackingItem,
} from '../src/queries/packing'
import { acceptInvitation, createHousehold } from '../src/queries/session'
import { createTrip } from '../src/queries/trips'
import type { Db, SessionContext } from '../src/queries/types'
import { createAuthUser, createTestDatabase, queryAs } from './support/database'

const now = new Date('2026-09-28T15:00:00Z')

let client: PGlite
let db: Db
let a: RequestContext
let viewer: RequestContext
let b: RequestContext
let stranger: SessionContext
let tripId: string

const passport = { label: 'Asha’s passport', category: 'Documents', assignedUserId: null, suggestionKey: 'passport:p1' }
const adapter = { label: 'Plug adapter', category: 'Electronics', assignedUserId: null, suggestionKey: 'plug_adapter' }

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  const ownerId = await createAuthUser(client, 'owner@example.com')
  const household = await createHousehold({ userId: ownerId, email: 'owner@example.com' }, db, {
    name: 'The Mehtas',
    timezone: 'Europe/Lisbon',
    currency: 'EUR',
  })
  a = { userId: ownerId, householdId: household.household.id, role: 'owner' }

  const viewerId = await createAuthUser(client, 'viewer@example.com')
  await createInvitation(a, db, {
    email: 'viewer@example.com',
    role: 'viewer',
    tokenHash: 'hash-viewer',
    expiresAt: invitationExpiresAt(now),
  })
  await acceptInvitation({ userId: viewerId, email: 'viewer@example.com' }, db, { tokenHash: 'hash-viewer', now })
  viewer = { userId: viewerId, householdId: a.householdId, role: 'viewer' }

  const strangerId = await createAuthUser(client, 'stranger@example.com')
  stranger = { userId: strangerId, email: 'stranger@example.com' }
  const other = await createHousehold(stranger, db, { name: 'Someone else', timezone: 'UTC', currency: 'USD' })
  b = { userId: strangerId, householdId: other.household.id, role: 'owner' }

  const base = { destination: 'Lisbon', status: 'booked' as const, coverImageUrl: null, budgetCents: null, notes: null }
  tripId = (await createTrip(a, db, { ...base, name: 'Lisbon', startsOn: '2026-12-18', endsOn: '2026-12-24', travellerIds: [] })).id
})

describe('adding suggestions', () => {
  it('puts them on the end of the list, in order, with their keys', async () => {
    await createPackingItem(a, db, tripId, { label: 'Sunscreen', assignedUserId: null, category: null })
    const added = await addSuggestedPackingItems(a, db, tripId, [passport, adapter])
    expect(added.map(item => [item.label, item.suggestionKey, item.sortOrder])).toEqual([
      ['Asha’s passport', 'passport:p1', 2],
      ['Plug adapter', 'plug_adapter', 3],
    ])
  })

  it('skips one already on the list, even after it was renamed', async () => {
    const [existing] = (await listPackingItems(a, db, tripId)).filter(item => item.suggestionKey === 'passport:p1')
    if (!existing) throw new Error('expected the passport')
    await updatePackingItem(a, db, tripId, existing.id, { label: 'Passport (blue folder)' })

    const added = await addSuggestedPackingItems(a, db, tripId, [passport])
    expect(added).toEqual([])
    expect((await listPackingItems(a, db, tripId)).filter(item => item.suggestionKey === 'passport:p1')).toHaveLength(1)
  })

  it('is for people who can change the trip', async () => {
    await expect(addSuggestedPackingItems(viewer, db, tripId, [adapter])).rejects.toBeInstanceOf(ForbiddenError)
    await expect(addSuggestedPackingItems(b, db, tripId, [adapter])).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('dismissing suggestions', () => {
  it('remembers them for the trip, once each', async () => {
    await dismissPackingSuggestions(a, db, tripId, ['stroller', 'diapers', 'stroller'])
    await dismissPackingSuggestions(a, db, tripId, ['stroller'])
    expect((await listDismissedSuggestionKeys(a, db, tripId)).toSorted()).toEqual(['diapers', 'stroller'])
    expect((await listDismissedSuggestionKeys(viewer, db, tripId)).toSorted()).toEqual(['diapers', 'stroller'])
  })

  it('keeps them to the household', async () => {
    await expect(dismissPackingSuggestions(viewer, db, tripId, ['baby_food'])).rejects.toBeInstanceOf(ForbiddenError)
    await expect(listDismissedSuggestionKeys(b, db, tripId)).rejects.toBeInstanceOf(NotFoundError)
    expect((await queryAs(client, viewer.userId, 'select suggestion_key from packing_suggestion_dismissals')).length).toBe(2)
    expect(await queryAs(client, stranger.userId, 'select suggestion_key from packing_suggestion_dismissals')).toHaveLength(0)
  })

  it('brings them all back', async () => {
    expect(await restorePackingSuggestions(a, db, tripId)).toBe(2)
    expect(await listDismissedSuggestionKeys(a, db, tripId)).toEqual([])
  })
})
