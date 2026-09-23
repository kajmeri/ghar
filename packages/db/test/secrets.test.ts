import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { listSealedSecrets, replaceSealedSecret } from '../src/queries/secrets'
import type { Db } from '../src/queries/types'
import { calendarLinks, householdMembers, households, mailLinks, plaidItems, profiles } from '../src/schema'
import { createAuthUser, createTestDatabase } from './support/database'

let db: Db
let ids: { item: string; calendar: string; mail: string }

beforeAll(async () => {
  const test = await createTestDatabase()
  db = test.db
  const userId = await createAuthUser(test.client, 'owner@example.com')
  await db.insert(profiles).values({ id: userId })
  const [household] = await db.insert(households).values({ name: 'Home', timezone: 'UTC', currency: 'USD' }).returning()
  if (!household) throw new Error('household insert returned no row')
  const householdId = household.id
  await db.insert(householdMembers).values({ householdId, userId, role: 'owner' })

  const [item] = await db
    .insert(plaidItems)
    .values({ householdId, environment: 'fake', plaidItemId: 'item-1', accessTokenEncrypted: 'v1.item' })
    .returning()
  const [calendar] = await db
    .insert(calendarLinks)
    .values({
      householdId,
      userId,
      provider: 'google',
      accountEmail: 'owner@example.com',
      calendarId: 'primary',
      refreshTokenEncrypted: 'v1.calendar',
    })
    .returning()
  const [mail] = await db
    .insert(mailLinks)
    .values({ householdId, userId, accountEmail: 'owner@example.com', refreshTokenEncrypted: 'v1.mail' })
    .returning()
  if (!item || !calendar || !mail) throw new Error('token row insert returned no row')
  ids = { item: item.id, calendar: calendar.id, mail: mail.id }
})

describe('sealed secrets', () => {
  it('lists every sealed column across households', async () => {
    const rows = await listSealedSecrets(db)
    expect(rows).toEqual(
      expect.arrayContaining([
        { table: 'plaid_items', id: ids.item, sealed: 'v1.item' },
        { table: 'calendar_links', id: ids.calendar, sealed: 'v1.calendar' },
        { table: 'mail_links', id: ids.mail, sealed: 'v1.mail' },
      ])
    )
    expect(rows).toHaveLength(3)
  })

  it('replaces a value only while the row still holds the one that was read', async () => {
    expect(await replaceSealedSecret(db, { table: 'mail_links', id: ids.mail, sealed: 'v1.mail', resealed: 'v1.mail-new' })).toBe(true)
    // A second pass read the old value before the first wrote, so it must not overwrite.
    expect(await replaceSealedSecret(db, { table: 'mail_links', id: ids.mail, sealed: 'v1.mail', resealed: 'v1.mail-stale' })).toBe(false)
    expect(await replaceSealedSecret(db, { table: 'plaid_items', id: ids.item, sealed: 'v1.item', resealed: 'v1.item-new' })).toBe(true)
    expect(
      await replaceSealedSecret(db, { table: 'calendar_links', id: ids.calendar, sealed: 'v1.calendar', resealed: 'v1.calendar-new' })
    ).toBe(true)

    expect((await listSealedSecrets(db)).map(row => row.sealed).toSorted()).toEqual(['v1.calendar-new', 'v1.item-new', 'v1.mail-new'])
  })

  it('has nothing to reseal for a connection that was turned off', async () => {
    await db.update(plaidItems).set({ accessTokenEncrypted: null }).where(eq(plaidItems.id, ids.item))
    const rows = await listSealedSecrets(db)
    expect(rows.some(row => row.table === 'plaid_items')).toBe(false)
    expect(rows).toHaveLength(2)
  })
})
