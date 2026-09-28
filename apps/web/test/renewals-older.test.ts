import type { RequestContext } from '@ghar/contracts'
import { createHousehold, createRenewal, type Db, type RenewalInput } from '@ghar/db/queries'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import type { Session } from '@/lib/api/authed'
import { hasExpiriesBefore } from '@/lib/renewals/service'

// The renewals page offers "Show older ones" only when something ran out before the past year.

const test = vi.hoisted(() => ({ db: undefined as unknown }))
vi.mock('@/lib/db', () => ({ getDb: () => test.db }))

let db: Db
let session: Session

function renewal(overrides: Partial<RenewalInput>): RenewalInput {
  return {
    title: 'Car registration',
    kind: 'registration',
    expiresOn: '2026-12-01',
    cadenceMonths: 12,
    autoRenews: false,
    costCents: null,
    provider: null,
    referenceNumber: null,
    url: null,
    contactId: null,
    assetId: null,
    documentId: null,
    personId: null,
    notes: null,
    ...overrides,
  }
}

beforeAll(async () => {
  const database = await createTestDatabase()
  db = database.db
  test.db = db
  const account = { userId: await createAuthUser(database.client, 'owner@example.com'), email: 'owner@example.com' }
  const { household } = await createHousehold(account, db, { name: 'The Rao household', timezone: 'UTC', currency: 'USD' })
  const context: RequestContext = { userId: account.userId, householdId: household.id, role: 'owner' }
  session = { context, household: { id: household.id, name: household.name, timeZone: 'UTC', currency: 'USD', homeCountry: null } }
}, 60_000)

describe('whether there are older ones', () => {
  it('is no with nothing at all, or only recent and upcoming dates', async () => {
    expect(await hasExpiriesBefore(session, '2025-09-28')).toBe(false)
    await createRenewal(session.context, db, renewal({ title: 'Gym', expiresOn: '2026-03-01' }))
    await createRenewal(session.context, db, renewal({ title: 'Registration', expiresOn: '2026-12-01' }))
    expect(await hasExpiriesBefore(session, '2025-09-28')).toBe(false)
  })

  it('is yes once something ran out before then', async () => {
    await createRenewal(session.context, db, renewal({ title: 'Old lease', expiresOn: '2024-06-30' }))
    expect(await hasExpiriesBefore(session, '2025-09-28')).toBe(true)
    expect(await hasExpiriesBefore(session, '2024-06-30')).toBe(false)
  })
})
