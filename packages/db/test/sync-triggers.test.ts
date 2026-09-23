import type { PGlite } from '@electric-sql/pglite'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { SYNC_ENTITIES } from '@ghar/core/sync'
import { beforeAll, describe, expect, it } from 'vitest'
import { createContact, deleteContact, updateContact, type ContactInput } from '../src/queries/contacts'
import { setDigestPreferences } from '../src/queries/digest'
import { completeMaintenanceTask, createMaintenanceTask, deleteMaintenanceTask } from '../src/queries/home'
import { createInvitation } from '../src/queries/invitations'
import { addManualValue, createManualAccount, deleteManualAccount, deleteManualValue } from '../src/queries/manual-accounts'
import { createOption, createSlot, voteOnOption } from '../src/queries/itinerary'
import { removeMember } from '../src/queries/members'
import { acceptInvitation, createHousehold, updateProfile } from '../src/queries/session'
import { createTrip, deleteTrip } from '../src/queries/trips'
import type { Db, RequestContext } from '../src/queries/types'
import { createAuthUser, createTestDatabase, queryAs } from './support/database'

const now = new Date('2026-09-14T15:00:00Z')
const today = '2026-09-14'

let client: PGlite
let db: Db
let owner: RequestContext
let member: RequestContext
let next: RequestContext

async function join(householdOwner: RequestContext, email: string, role: 'adult' | 'member' | 'viewer'): Promise<RequestContext> {
  const userId = await createAuthUser(client, email)
  await createInvitation(householdOwner, db, { email, role, tokenHash: `hash-${email}`, expiresAt: invitationExpiresAt(now) })
  await acceptInvitation({ userId, email }, db, { tokenHash: `hash-${email}`, now })
  return { userId, householdId: householdOwner.householdId, role }
}

const contact = (overrides: Partial<ContactInput> = {}): ContactInput => ({
  name: 'Dave the plumber',
  role: 'Plumber',
  phone: null,
  email: null,
  url: null,
  notes: null,
  tags: [],
  ...overrides,
})

const trip = {
  name: 'Lisbon',
  destination: 'Lisbon',
  startsOn: '2026-10-01',
  endsOn: '2026-10-05',
  status: 'planned',
  coverImageUrl: null,
  budgetCents: null,
  notes: null,
  memberUserIds: [],
} as const

const slot = {
  day: '2026-10-01',
  band: 'evening',
  kind: 'meal',
  label: 'Dinner',
  startsAt: null,
  endsAt: null,
  decideBy: null,
  notes: null,
} as const

/** The row's updated_at as text, which keeps the microseconds a Date would drop. */
async function stamp(table: string, where: string, params: unknown[]): Promise<string> {
  const { rows } = await client.query<{ at: string }>(`select updated_at::text as at from ${table} where ${where}`, params)
  expect(rows).toHaveLength(1)
  return rows[0]?.at ?? ''
}

type Tombstone = { entity: string; entity_id: string; user_id: string | null }

async function tombstones(householdId: string): Promise<Tombstone[]> {
  const { rows } = await client.query<Tombstone>(
    'select entity, entity_id, user_id from sync_tombstones where household_id = $1 order by deleted_at, id',
    [householdId]
  )
  return rows
}

/** Runs `work` and returns the tombstones it wrote for the household. */
async function tombstonesFrom(householdId: string, work: () => Promise<unknown>): Promise<Tombstone[]> {
  const before = (await tombstones(householdId)).length
  await work()
  return (await tombstones(householdId)).slice(before)
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  const ownerId = await createAuthUser(client, 'owner@example.com')
  const household = await createHousehold({ userId: ownerId, email: 'owner@example.com' }, db, {
    name: 'The Rao household',
    timezone: 'America/Chicago',
    currency: 'USD',
  })
  owner = { userId: ownerId, householdId: household.household.id, role: 'owner' }
  member = await join(owner, 'member@example.com', 'member')

  const nextId = await createAuthUser(client, 'next@example.com')
  const nextHousehold = await createHousehold({ userId: nextId, email: 'next@example.com' }, db, {
    name: 'Next door',
    timezone: 'America/New_York',
    currency: 'USD',
  })
  next = { userId: nextId, householdId: nextHousehold.household.id, role: 'owner' }
}, 60_000)

describe('the schema sync relies on', () => {
  it('indexes every foreign key', async () => {
    const { rows } = await client.query<{ fk: string }>(`
      select c.conrelid::regclass::text || '(' || string_agg(a.attname, ',' order by k.ord) || ')' as fk
      from pg_constraint c
      cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey
        )
      group by c.oid, c.conrelid`)
    expect(rows.map(row => row.fk)).toEqual([])
  })

  it('keeps updated_at current on every table that has one', async () => {
    const { rows } = await client.query<{ table: string }>(`
      select t.relname as table
      from pg_class t
      join pg_attribute a on a.attrelid = t.oid and a.attname = 'updated_at' and not a.attisdropped
      where t.relnamespace = 'public'::regnamespace and t.relkind = 'r'
        and not exists (select 1 from pg_trigger g where g.tgrelid = t.oid and g.tgname = t.relname || '_set_updated_at')`)
    expect(rows.map(row => row.table)).toEqual([])
  })

  it('gives every touch and tombstone trigger columns that exist and entities sync knows', async () => {
    const { rows } = await client.query<{ table: string; fn: string; args: string }>(`
      select g.tgrelid::regclass::text as table, p.proname as fn, encode(g.tgargs, 'escape') as args
      from pg_trigger g join pg_proc p on p.oid = g.tgfoid
      where p.proname in ('touch_parent', 'record_tombstone')`)
    const { rows: columns } = await client.query<{ key: string }>(
      "select table_name || '.' || column_name as key from information_schema.columns where table_schema = 'public'"
    )
    const exists = new Set(columns.map(column => column.key))
    const problems: string[] = []
    const need = (key: string) => {
      if (!exists.has(key)) problems.push(key)
    }
    for (const row of rows) {
      // Each argument ends in a NUL, so the last piece is always empty; '' in the middle is a real argument.
      const args = row.args.split('\\000').slice(0, -1)
      if (row.fn === 'touch_parent') {
        const [parent, parentColumn, childColumn] = args
        need(`${String(parent)}.${String(parentColumn)}`)
        need(`${parent === 'household_members' ? 'profiles' : row.table}.${String(childColumn)}`)
        need(`${String(parent)}.updated_at`)
      } else {
        const [entity, idColumn, userColumn, parent, parentColumn] = args
        if (!SYNC_ENTITIES.includes(entity as (typeof SYNC_ENTITIES)[number])) problems.push(`entity ${String(entity)}`)
        need(`${row.table}.${String(idColumn)}`)
        if (userColumn) need(`${row.table}.${userColumn}`)
        if (parent) {
          need(`${parent}.household_id`)
          need(`${row.table}.${String(parentColumn)}`)
        } else need(`${row.table}.household_id`)
      }
    }
    expect(rows.length).toBeGreaterThan(25)
    expect(problems).toEqual([])
  })
})

describe('updated_at', () => {
  it('moves when a row changes and stays put when an update changes nothing', async () => {
    const plumber = await createContact(owner, db, contact())
    const created = await stamp('contacts', 'id = $1', [plumber.id])

    await client.query('update contacts set name = name where id = $1', [plumber.id])
    expect(await stamp('contacts', 'id = $1', [plumber.id])).toBe(created)

    await updateContact(owner, db, plumber.id, contact({ phone: '(512) 555-0148' }))
    expect(await stamp('contacts', 'id = $1', [plumber.id]) > created).toBe(true)
  })

  it('moves a slot and its option when someone votes', async () => {
    const lisbon = await createTrip(owner, db, trip)
    const dinner = await createSlot(owner, db, lisbon.id, slot)
    const [ramiro] = (await createOption(owner, db, lisbon.id, dinner.id, { title: 'Ramiro' })).options
    if (!ramiro) throw new Error('expected an option')
    const slotBefore = await stamp('itinerary_slots', 'id = $1', [dinner.id])
    const optionBefore = await stamp('itinerary_options', 'id = $1', [ramiro.id])

    await voteOnOption(member, db, lisbon.id, ramiro.id, { vote: 'yes' })

    expect(await stamp('itinerary_options', 'id = $1', [ramiro.id]) > optionBefore).toBe(true)
    expect(await stamp('itinerary_slots', 'id = $1', [dinner.id]) > slotBefore).toBe(true)
  })

  it("moves a person's member rows when their name changes", async () => {
    const before = await stamp('household_members', 'household_id = $1 and user_id = $2', [owner.householdId, member.userId])
    await updateProfile({ userId: member.userId, email: 'member@example.com' }, db, { fullName: 'Asha Rao' })
    expect(await stamp('household_members', 'household_id = $1 and user_id = $2', [owner.householdId, member.userId]) > before).toBe(true)
  })
})

describe('tombstones', () => {
  it('records a deleted row for the whole household', async () => {
    const plumber = await createContact(owner, db, contact({ name: 'Old plumber' }))
    expect(await tombstonesFrom(owner.householdId, () => deleteContact(owner, db, plumber.id))).toEqual([
      { entity: 'contact', entity_id: plumber.id, user_id: null },
    ])
  })

  it('keeps tombstones away from PostgREST, even for the household they belong to', async () => {
    expect((await tombstones(owner.householdId)).length).toBeGreaterThan(0)
    expect(await queryAs(client, owner.userId, 'select * from sync_tombstones')).toEqual([])
    expect(await queryAs(client, owner.userId, 'select * from api_tokens')).toEqual([])
  })

  it('finds the household through the parent for a child table without one', async () => {
    const task = await createMaintenanceTask(owner, db, {
      title: 'Flush the tank',
      assetId: null,
      cadenceMonths: 3,
      cadenceMiles: null,
      lastDoneOn: '2026-06-01',
      nextDueOn: null,
      assignedUserId: null,
      instructions: null,
      vendorContactId: null,
    })
    const { entry } = await completeMaintenanceTask(owner, db, task.id, { completedOn: today, today, costCents: null, notes: null, documentId: null })
    expect(await tombstonesFrom(owner.householdId, () => client.query('delete from maintenance_log where id = $1', [entry.id]))).toEqual([
      { entity: 'maintenance_log', entity_id: entry.id, user_id: null },
    ])

    // Deleting the task takes its history with it; the client drops that with the task.
    const { entry: second } = await completeMaintenanceTask(owner, db, task.id, { completedOn: today, today, costCents: null, notes: null, documentId: null })
    expect(second.id).toBeTruthy()
    expect(await tombstonesFrom(owner.householdId, () => deleteMaintenanceTask(owner, db, task.id))).toEqual([
      { entity: 'maintenance', entity_id: task.id, user_id: null },
    ])
  })

  it('records a manual value with the household from its account, and moves the account', async () => {
    const house = await createManualAccount(
      owner,
      db,
      { name: 'House', kind: 'property', notes: null, reminderCadenceMonths: 6, isLiability: false },
      { asOf: '2026-03-01', valueCents: 48_000_000, source: 'estimate', notes: null }
    )
    const before = await stamp('manual_accounts', 'id = $1', [house.id])
    const { value } = await addManualValue(owner, db, house.id, { asOf: today, valueCents: 49_500_000, source: 'estimate', notes: null })
    const afterAdd = await stamp('manual_accounts', 'id = $1', [house.id])
    expect(afterAdd > before).toBe(true)

    expect(await tombstonesFrom(owner.householdId, () => deleteManualValue(owner, db, house.id, value.id))).toEqual([
      { entity: 'manual_value', entity_id: value.id, user_id: null },
    ])
    expect((await stamp('manual_accounts', 'id = $1', [house.id])) > afterAdd).toBe(true)

    // The account's tombstone covers its values; they are not listed one by one.
    expect(await tombstonesFrom(owner.householdId, () => deleteManualAccount(owner, db, house.id))).toEqual([
      { entity: 'manual_account', entity_id: house.id, user_id: null },
    ])
  })

  it("marks something only one person sees as theirs", async () => {
    await setDigestPreferences(member, db, { enabled: true, sections: ['bills'], sendHour: 7 })
    const written = await tombstonesFrom(owner.householdId, () =>
      client.query('delete from digest_preferences where household_id = $1 and user_id = $2', [owner.householdId, member.userId])
    )
    expect(written).toEqual([{ entity: 'digest_preferences', entity_id: member.userId, user_id: member.userId }])
  })

  it('records only the trip when a trip goes, not everything inside it', async () => {
    const porto = await createTrip(owner, db, { ...trip, name: 'Porto' })
    await createSlot(owner, db, porto.id, slot)
    await createSlot(owner, db, porto.id, { ...slot, band: 'midday', label: 'Lunch' })
    expect(await tombstonesFrom(owner.householdId, () => deleteTrip(owner, db, porto.id))).toEqual([
      { entity: 'trip', entity_id: porto.id, user_id: null },
    ])
  })

  it('records a slot deleted on its own, with the household from its trip', async () => {
    const faro = await createTrip(owner, db, { ...trip, name: 'Faro' })
    const lunch = await createSlot(owner, db, faro.id, { ...slot, band: 'midday', label: 'Lunch' })
    expect(await tombstonesFrom(owner.householdId, () => client.query('delete from itinerary_slots where id = $1', [lunch.id]))).toEqual([
      { entity: 'itinerary_slot', entity_id: lunch.id, user_id: null },
    ])
  })

  it('records a member who leaves, and what was theirs alone', async () => {
    const leaver = await join(owner, 'leaver@example.com', 'adult')
    await setDigestPreferences(leaver, db, { enabled: true, sections: ['bills'], sendHour: 7 })
    const written = await tombstonesFrom(owner.householdId, () => removeMember(owner, db, { userId: leaver.userId }))
    expect(written).toContainEqual({ entity: 'member', entity_id: leaver.userId, user_id: null })
    expect(written).toContainEqual({ entity: 'digest_preferences', entity_id: leaver.userId, user_id: leaver.userId })
  })

  it('deletes a whole household without tripping over its own tombstones', async () => {
    const neighbor = await join(next, 'neighbor@example.com', 'member')
    await createContact(next, db, contact())
    const cabin = await createTrip(next, db, { ...trip, name: 'Cabin', memberUserIds: [neighbor.userId] })
    await createSlot(next, db, cabin.id, slot)
    await setDigestPreferences(neighbor, db, { enabled: true, sections: ['bills'], sendHour: 7 })

    await client.query('delete from households where id = $1', [next.householdId])

    expect(await tombstones(next.householdId)).toEqual([])
    const { rows } = await client.query<{ count: number }>('select count(*)::int as count from household_members where household_id = $1', [
      next.householdId,
    ])
    expect(rows[0]?.count).toBe(0)
  })
})
