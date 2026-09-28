import type { PGlite } from '@electric-sql/pglite'
import type { RequestContext } from '@ghar/contracts'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { beforeAll, describe, expect, it } from 'vitest'
import { createMaintenanceTask, getMaintenanceTask } from '../src/queries/home'
import { createInvitation } from '../src/queries/invitations'
import { removeMember } from '../src/queries/members'
import { createPackingItem, listPackingItems } from '../src/queries/packing'
import { acceptInvitation, createHousehold } from '../src/queries/session'
import { createTrip } from '../src/queries/trips'
import type { Db } from '../src/queries/types'
import { createAuthUser, createTestDatabase } from './support/database'

const now = new Date()
let client: PGlite
let db: Db
let owner: RequestContext
let leaverId: string

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  const ownerId = await createAuthUser(client, 'owner@example.com')
  const created = await createHousehold({ userId: ownerId, email: 'owner@example.com' }, db, {
    name: 'Household',
    timezone: 'America/Chicago',
    currency: 'USD',
  })
  owner = { userId: ownerId, householdId: created.household.id, role: 'owner' }

  leaverId = await createAuthUser(client, 'leaver@example.com')
  await createInvitation(owner, db, {
    email: 'leaver@example.com',
    role: 'member',
    tokenHash: 'hash-leaver',
    expiresAt: invitationExpiresAt(now),
  })
  await acceptInvitation({ userId: leaverId, email: 'leaver@example.com' }, db, { tokenHash: 'hash-leaver', now })
})

describe('removing a member', () => {
  it('hands what they were packing and fixing back to the household', async () => {
    const trip = await createTrip(owner, db, {
      name: 'Coast',
      destination: null,
      startsOn: null,
      endsOn: null,
      status: 'idea',
      coverImageUrl: null,
      budgetCents: null,
      notes: null,
      travellerIds: [],
    })
    await createPackingItem(owner, db, trip.id, { label: 'Tent', assignedUserId: leaverId, category: null })
    await createPackingItem(owner, db, trip.id, { label: 'Map', assignedUserId: owner.userId, category: null })
    const task = await createMaintenanceTask(owner, db, {
      title: 'Clear the gutters',
      assetId: null,
      cadenceMonths: null,
      cadenceMiles: null,
      lastDoneOn: null,
      nextDueOn: null,
      assignedUserId: leaverId,
      instructions: null,
      vendorContactId: null,
    })

    await removeMember(owner, db, { userId: leaverId })

    const items = await listPackingItems(owner, db, trip.id)
    expect(Object.fromEntries(items.map(item => [item.label, item.assignedUserId]))).toEqual({ Tent: null, Map: owner.userId })
    expect((await getMaintenanceTask(owner, db, task.id)).assignedUserId).toBeNull()
  })
})
