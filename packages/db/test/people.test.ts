import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as joinPath } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { documentStoragePath, type DocumentKind } from '@ghar/core/documents'
import { ForbiddenError, NotFoundError, ValidationError } from '@ghar/core/errors'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, describe, expect, it } from 'vitest'
import { createDocument, getDocument, listPassports, updateDocument, type DocumentInput } from '../src/queries/documents'
import { createInvitation } from '../src/queries/invitations'
import { removeMember } from '../src/queries/members'
import { createPerson, deletePerson, listPeople, requireOwnPerson, updatePerson } from '../src/queries/people'
import { acceptInvitation, createHousehold, updateProfile } from '../src/queries/session'
import { createTrip, getTripWithCounts, updateTrip, type CreateTripInput } from '../src/queries/trips'
import type { Db, RequestContext } from '../src/queries/types'
import { MIGRATIONS_FOLDER, createAuthUser, createTestDatabase, queryAs } from './support/database'

const now = new Date('2026-09-23T12:00:00Z')
const TODAY = '2026-09-23'

let client: PGlite
let db: Db
let owner: RequestContext
let member: RequestContext
let viewer: RequestContext
let other: RequestContext

async function household(email: string, name: string): Promise<RequestContext> {
  const userId = await createAuthUser(client, email)
  const joined = await createHousehold({ userId, email }, db, { name, timezone: 'America/Chicago', currency: 'USD' })
  return { userId, householdId: joined.household.id, role: 'owner' }
}

async function join(householdOwner: RequestContext, email: string, role: 'adult' | 'member' | 'viewer'): Promise<RequestContext> {
  const userId = await createAuthUser(client, email)
  await createInvitation(householdOwner, db, { email, role, tokenHash: `hash-${email}`, expiresAt: invitationExpiresAt(now) })
  await acceptInvitation({ userId, email }, db, { tokenHash: `hash-${email}`, now })
  return { userId, householdId: householdOwner.householdId, role }
}

const trip = (overrides: Partial<CreateTripInput> = {}): CreateTripInput => ({
  name: 'Lisbon',
  destination: 'Lisbon',
  startsOn: '2027-03-01',
  endsOn: '2027-03-15',
  status: 'planned',
  coverImageUrl: null,
  budgetCents: null,
  notes: null,
  travellerIds: [],
  ...overrides,
})

function document(ctx: RequestContext, overrides: Partial<DocumentInput> & { kind?: DocumentKind } = {}) {
  return {
    title: 'Passport',
    kind: 'passport' as const,
    issuedOn: null,
    expiresOn: '2030-01-01',
    issuer: null,
    referenceNumber: null,
    assetId: null,
    personId: null,
    notes: null,
    isSensitive: true,
    storagePath: documentStoragePath(ctx.householdId, randomUUID(), 'image/jpeg'),
    mimeType: 'image/jpeg' as const,
    sizeBytes: 1024,
    ...overrides,
  }
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  owner = await household('owner@example.com', 'Home')
  member = await join(owner, 'member@example.com', 'member')
  viewer = await join(owner, 'viewer@example.com', 'viewer')
  other = await household('other@example.com', 'Next door')
})

describe('people', () => {
  it('has everyone who joined, named from their profile', async () => {
    await updateProfile({ userId: member.userId, email: 'member@example.com' }, db, { fullName: 'Sam' })
    const people = await listPeople(viewer, db)
    expect(people.map(person => [person.userId, person.name])).toEqual([
      [owner.userId, null],
      [member.userId, 'Sam'],
      [viewer.userId, null],
    ])
    expect(await listPeople(other, db)).toHaveLength(1)
  })

  it('adds, renames and removes someone without an account, for owners and adults only', async () => {
    await expect(createPerson(member, db, { name: 'Maya' }, TODAY)).rejects.toThrow(ForbiddenError)
    await expect(createPerson(owner, db, { name: '   ' }, TODAY)).rejects.toThrow(ValidationError)

    const maya = await createPerson(owner, db, { name: ' Maya ' }, TODAY)
    expect(maya).toMatchObject({ userId: null, name: 'Maya' })
    expect(await updatePerson(owner, db, maya.id, { name: 'Maya J' }, TODAY)).toMatchObject({ name: 'Maya J' })
    await expect(updatePerson(other, db, maya.id, { name: 'Mine now' }, TODAY)).rejects.toThrow(NotFoundError)

    await deletePerson(owner, db, maya.id)
    await expect(deletePerson(owner, db, maya.id)).rejects.toThrow(NotFoundError)
  })

  it("won't rename or delete a member from here", async () => {
    const memberPerson = await requireOwnPerson(member, db)
    await expect(updatePerson(owner, db, memberPerson, { name: 'Samuel' }, TODAY)).rejects.toThrow(ValidationError)
    await expect(deletePerson(owner, db, memberPerson)).rejects.toThrow(ValidationError)
  })

  it('keeps an optional birth date, for anyone, and only ever in the past', async () => {
    const baby = await createPerson(owner, db, { name: 'Kabir', birthDate: '2025-02-14' }, TODAY)
    expect(baby).toMatchObject({ name: 'Kabir', birthDate: '2025-02-14' })
    expect(await createPerson(owner, db, { name: 'Tara' }, TODAY)).toMatchObject({ birthDate: null })

    await expect(createPerson(owner, db, { name: 'Soon', birthDate: '2026-09-24' }, TODAY)).rejects.toThrow(ValidationError)
    await expect(updatePerson(owner, db, baby.id, { birthDate: '1899-12-31' }, TODAY)).rejects.toThrow(ValidationError)
    await expect(updatePerson(owner, db, baby.id, { birthDate: '2025-02-30' }, TODAY)).rejects.toThrow(ValidationError)

    // A birth date alone leaves the name be, and clearing it leaves nothing behind.
    expect(await updatePerson(owner, db, baby.id, { birthDate: TODAY }, TODAY)).toMatchObject({ name: 'Kabir', birthDate: TODAY })
    expect(await updatePerson(owner, db, baby.id, { birthDate: null }, TODAY)).toMatchObject({ birthDate: null })

    const audits = await client.query<{ metadata: unknown }>(
      `select metadata from audit_log where action = 'person.birth_date_changed' and entity_id = '${baby.id}' order by created_at`
    )
    expect(audits.rows).toEqual([{ metadata: { set: true } }, { metadata: { set: false } }])
  })

  it('lets a member set their own birth date, but only owners and adults set anyone else’s', async () => {
    const memberPerson = await requireOwnPerson(member, db)
    const ownerPerson = await requireOwnPerson(owner, db)
    expect(await updatePerson(member, db, memberPerson, { birthDate: '1990-06-01' }, TODAY)).toMatchObject({ birthDate: '1990-06-01' })
    expect(await updatePerson(owner, db, memberPerson, { birthDate: '1990-06-02' }, TODAY)).toMatchObject({ birthDate: '1990-06-02' })
    await expect(updatePerson(member, db, ownerPerson, { birthDate: '1985-01-01' }, TODAY)).rejects.toThrow(ForbiddenError)
    await expect(updatePerson(viewer, db, memberPerson, { birthDate: '1985-01-01' }, TODAY)).rejects.toThrow(ForbiddenError)
    // Their own birth date isn't a way to rename themselves here.
    await expect(updatePerson(member, db, memberPerson, { name: 'Samuel' }, TODAY)).rejects.toThrow(ForbiddenError)
    await expect(updatePerson(other, db, memberPerson, { birthDate: '1985-01-01' }, TODAY)).rejects.toThrow(NotFoundError)
  })

  it('is readable by the household only', async () => {
    const mine = await queryAs<{ id: string }>(client, member.userId, 'select id from household_people')
    expect(mine).toHaveLength((await listPeople(owner, db)).length)
    const theirs = await queryAs<{ id: string }>(
      client,
      other.userId,
      `select id from household_people where household_id = '${owner.householdId}'`
    )
    expect(theirs).toEqual([])
  })
})

describe('trip travellers', () => {
  it('puts the creator on the trip, and takes anyone in the household', async () => {
    const kid = await createPerson(owner, db, { name: 'Ari' }, TODAY)
    const lisbon = await createTrip(member, db, trip({ travellerIds: [kid.id] }))
    const memberPerson = await requireOwnPerson(member, db)
    expect(lisbon.travellerIds).toEqual([memberPerson, kid.id])
    expect((await getTripWithCounts(owner, db, lisbon.id)).travellerIds.sort()).toEqual([memberPerson, kid.id].sort())

    await expect(updateTrip(member, db, lisbon.id, { travellerIds: [await requireOwnPerson(other, db)] })).rejects.toThrow(ValidationError)
    const updated = await updateTrip(member, db, lisbon.id, { travellerIds: [kid.id], international: true })
    expect(updated).toMatchObject({ travellerIds: [kid.id], international: true })
  })

  it('keeps someone who leaves on their trips, under the name they had', async () => {
    const leaver = await join(owner, 'leaver@example.com', 'adult')
    await updateProfile({ userId: leaver.userId, email: 'leaver@example.com' }, db, { fullName: 'Jo' })
    const leaverPerson = await requireOwnPerson(leaver, db)
    const goa = await createTrip(leaver, db, trip({ name: 'Goa' }))

    await removeMember(owner, db, { userId: leaver.userId })
    const people = await listPeople(owner, db)
    expect(people.find(person => person.id === leaverPerson)).toMatchObject({ userId: null, name: 'Jo' })
    expect((await getTripWithCounts(owner, db, goa.id)).travellerIds).toEqual([leaverPerson])
  })
})

describe('whose a document is', () => {
  it('names the person, and only one in the household', async () => {
    const kid = await createPerson(owner, db, { name: 'Ari' }, TODAY)
    const passport = await createDocument(owner, db, document(owner, { personId: kid.id }))
    expect(passport).toMatchObject({ personId: kid.id, personName: 'Ari', personUserId: null })

    const theirs = await requireOwnPerson(other, db)
    await expect(createDocument(owner, db, document(owner, { personId: theirs }))).rejects.toThrow(ValidationError)
    const { storagePath: _path, mimeType: _mime, sizeBytes: _size, ...fields } = document(owner, { personId: theirs })
    await expect(updateDocument(owner, db, passport.id, fields)).rejects.toThrow(ValidationError)

    // Deleting the person keeps the passport, belonging to nobody.
    await deletePerson(owner, db, kid.id)
    expect(await getDocument(owner, db, passport.id)).toMatchObject({ personId: null, personName: null })
  })

  it('finds passports by person, for those who can see sensitive documents', async () => {
    const kid = await createPerson(owner, db, { name: 'Lea' }, TODAY)
    const ownerPerson = await requireOwnPerson(owner, db)
    const passport = await createDocument(owner, db, document(owner, { personId: kid.id, expiresOn: '2027-05-01' }))
    await createDocument(owner, db, document(owner, { personId: kid.id, kind: 'id', title: 'School ID' }))

    expect(await listPassports(owner, db, [kid.id, ownerPerson])).toEqual([{ id: passport.id, personId: kid.id, expiresOn: '2027-05-01' }])
    expect(await listPassports(other, db, [kid.id])).toEqual([])
    await expect(listPassports(member, db, [kid.id])).rejects.toThrow(ForbiddenError)
  })
})

describe('migrating trip members to travellers', () => {
  // It migrates two databases, one of them twice, so it gets the time a hook gets.
  it('makes every member a person and keeps who was going', async () => {
    const before = mkdtempSync(joinPath(tmpdir(), 'ghar-migrations-'))
    try {
      cpSync(MIGRATIONS_FOLDER, before, { recursive: true })
      const journalPath = joinPath(before, 'meta/_journal.json')
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] }
      journal.entries = journal.entries.filter(entry => entry.tag < '0015')
      writeFileSync(journalPath, JSON.stringify(journal))

      const { client: legacy, db: legacyDb } = await createTestDatabase({ migrationsFolder: before })
      const [a, b] = [randomUUID(), randomUUID()]
      await legacy.exec(`
        insert into auth.users (id, email) values ('${a}', 'a@example.com'), ('${b}', 'b@example.com');
        insert into profiles (id, full_name) values ('${a}', 'Asha'), ('${b}', null);
        insert into households (id, name, timezone, currency) values ('00000000-0000-4000-8000-000000000001', 'Home', 'UTC', 'USD');
        insert into household_members (household_id, user_id, role) values
          ('00000000-0000-4000-8000-000000000001', '${a}', 'owner'),
          ('00000000-0000-4000-8000-000000000001', '${b}', 'member');
        insert into trips (id, household_id, name) values ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'Lisbon');
        insert into trip_members (trip_id, user_id) values ('00000000-0000-4000-8000-000000000011', '${b}');
      `)

      await migrate(legacyDb, { migrationsFolder: MIGRATIONS_FOLDER })

      const { rows: people } = await legacy.query<{ user_id: string; name: string | null }>(
        'select user_id, name from household_people order by user_id'
      )
      expect(people).toEqual([a, b].sort().map(userId => ({ user_id: userId, name: null })))
      const { rows: travellers } = await legacy.query<{ user_id: string }>(
        'select p.user_id from trip_travellers t join household_people p on p.id = t.person_id'
      )
      expect(travellers).toEqual([{ user_id: b }])
      const { rows: gone } = await legacy.query<{ table: string | null }>(`select to_regclass('public.trip_members')::text as table`)
      expect(gone).toEqual([{ table: null }])
      await legacy.close()
    } finally {
      rmSync(before, { recursive: true, force: true })
    }
  }, 60_000)
})
