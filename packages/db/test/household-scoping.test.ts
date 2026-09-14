import type { PGlite } from '@electric-sql/pglite'
import type { RequestContext } from '@ghar/contracts'
import { ConflictError, ForbiddenError, NotFoundError } from '@ghar/core/errors'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { and, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { auditLog, jobRuns } from '../src/schema'
import { getHousehold } from '../src/queries/households'
import { createInvitation, listPendingInvitations, revokeInvitation } from '../src/queries/invitations'
import { changeMemberRole, listMembers, removeMember } from '../src/queries/members'
import { acceptInvitation, createHousehold, findMembership, previewInvitation } from '../src/queries/session'
import type { Db } from '../src/queries/types'
import { createAuthUser, createTestDatabase, queryAs } from './support/database'

const now = new Date()
const expiresAt = invitationExpiresAt(now)

let client: PGlite
let db: Db
const users = { ownerA: '', adultA: '', ownerB: '' }
let a: RequestContext
let adultA: RequestContext
let b: RequestContext
let pendingInvitationId: string

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  users.ownerA = await createAuthUser(client, 'owner-a@example.com')
  users.adultA = await createAuthUser(client, 'adult-a@example.com')
  users.ownerB = await createAuthUser(client, 'owner-b@example.com')

  const householdA = await createHousehold({ userId: users.ownerA, email: 'owner-a@example.com' }, db, {
    name: 'Household A',
    timezone: 'America/Chicago',
    currency: 'USD',
  })
  a = { userId: users.ownerA, householdId: householdA.household.id, role: 'owner' }

  const householdB = await createHousehold({ userId: users.ownerB, email: 'owner-b@example.com' }, db, {
    name: 'Household B',
    timezone: 'Europe/Lisbon',
    currency: 'EUR',
  })
  b = { userId: users.ownerB, householdId: householdB.household.id, role: 'owner' }

  await createInvitation(a, db, {
    email: 'Adult-A@example.com',
    role: 'adult',
    tokenHash: 'hash-adult-a',
    expiresAt,
  })
  await acceptInvitation({ userId: users.adultA, email: 'adult-a@example.com' }, db, {
    tokenHash: 'hash-adult-a',
    now,
  })
  adultA = { userId: users.adultA, householdId: a.householdId, role: 'adult' }

  const pending = await createInvitation(a, db, {
    email: 'pending@example.com',
    role: 'viewer',
    tokenHash: 'hash-pending',
    expiresAt,
  })
  pendingInvitationId = pending.id
}, 60_000)

describe('household scoping in the data access layer', () => {
  it('returns nothing from household A to a ctx for household B', async () => {
    // Household A has data to find.
    expect(await listMembers(a, db)).toHaveLength(2)
    expect(await listPendingInvitations(a, db)).toHaveLength(1)

    const household = await getHousehold(b, db)
    expect(household.id).toBe(b.householdId)
    expect(household.name).toBe('Household B')

    const members = await listMembers(b, db)
    expect(members.map(member => member.userId)).toEqual([users.ownerB])
    expect(await listPendingInvitations(b, db)).toEqual([])
  })

  it("does not let a ctx for household B change household A's rows", async () => {
    await expect(changeMemberRole(b, db, { userId: users.adultA, role: 'viewer' })).rejects.toBeInstanceOf(NotFoundError)
    await expect(removeMember(b, db, { userId: users.adultA })).rejects.toBeInstanceOf(NotFoundError)
    await expect(revokeInvitation(b, db, { invitationId: pendingInvitationId })).rejects.toBeInstanceOf(NotFoundError)

    const members = await listMembers(a, db)
    expect(members.find(member => member.userId === users.adultA)?.role).toBe('adult')
    expect(await listPendingInvitations(a, db)).toHaveLength(1)
  })

  it('refuses a ctx whose user is not a member of its household', async () => {
    const forged: RequestContext = {
      userId: users.ownerB,
      householdId: a.householdId,
      role: 'owner',
    }
    await expect(changeMemberRole(forged, db, { userId: users.adultA, role: 'viewer' })).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('membership rules against the database', () => {
  it('resolves a session to its one household', async () => {
    expect(await findMembership({ userId: users.adultA, email: null }, db)).toEqual({
      householdId: a.householdId,
      role: 'adult',
    })
  })

  it('lets an owner change a role and records it', async () => {
    const member = await changeMemberRole(a, db, { userId: users.adultA, role: 'member' })
    expect(member).toMatchObject({
      userId: users.adultA,
      role: 'member',
      email: 'adult-a@example.com',
    })
    await changeMemberRole(a, db, { userId: users.adultA, role: 'adult' })

    const entries = await db
      .select({ metadata: auditLog.metadata })
      .from(auditLog)
      .where(and(eq(auditLog.householdId, a.householdId), eq(auditLog.action, 'member.role_changed')))
    expect(entries.map(entry => entry.metadata)).toEqual([
      { from: 'adult', to: 'member' },
      { from: 'member', to: 'adult' },
    ])
  })

  it('keeps member removal with owners', async () => {
    await expect(removeMember(adultA, db, { userId: users.ownerA })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(removeMember(a, db, { userId: users.ownerA })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('replaces the token when an address is invited again', async () => {
    const again = await createInvitation(adultA, db, {
      email: 'pending@example.com',
      role: 'member',
      tokenHash: 'hash-pending-2',
      expiresAt,
    })
    expect(again.id).toBe(pendingInvitationId)
    expect(again.role).toBe('member')
    await expect(previewInvitation({ userId: users.ownerB, email: null }, db, { tokenHash: 'hash-pending' })).rejects.toBeInstanceOf(
      NotFoundError
    )
  })

  it('refuses to invite someone already in the household', async () => {
    await expect(
      createInvitation(a, db, {
        email: 'adult-a@example.com',
        role: 'viewer',
        tokenHash: 'x',
        expiresAt,
      })
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('only lets the invited address accept, once, if they have no household', async () => {
    const preview = await previewInvitation({ userId: users.ownerB, email: 'owner-b@example.com' }, db, {
      tokenHash: 'hash-pending-2',
    })
    expect(preview).toMatchObject({ householdName: 'Household A', forYou: false })

    await expect(
      acceptInvitation({ userId: users.ownerB, email: 'owner-b@example.com' }, db, {
        tokenHash: 'hash-pending-2',
        now,
      })
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      acceptInvitation({ userId: users.adultA, email: 'adult-a@example.com' }, db, {
        tokenHash: 'hash-adult-a',
        now,
      })
    ).rejects.toBeInstanceOf(ConflictError)
    await expect(
      createHousehold({ userId: users.ownerB, email: 'owner-b@example.com' }, db, {
        name: 'Second',
        timezone: 'UTC',
        currency: 'USD',
      })
    ).rejects.toBeInstanceOf(ConflictError)
  })
})

describe('row-level security', () => {
  beforeAll(async () => {
    await db.insert(jobRuns).values({ jobName: 'test', status: 'succeeded' })
  })

  it('shows the authenticated role only its own household', async () => {
    const householdIds = await queryAs<{ id: string }>(client, users.ownerB, 'select id from households')
    expect(householdIds.map(row => row.id)).toEqual([b.householdId])

    const members = await queryAs<{ user_id: string }>(client, users.ownerB, 'select user_id from household_members')
    expect(members.map(row => row.user_id)).toEqual([users.ownerB])

    const profiles = await queryAs<{ id: string }>(client, users.ownerB, 'select id from profiles')
    expect(profiles.map(row => row.id)).toEqual([users.ownerB])

    const audit = await queryAs<{ household_id: string }>(client, users.ownerB, 'select household_id from audit_log')
    expect(audit.length).toBeGreaterThan(0)
    expect(audit.every(row => row.household_id === b.householdId)).toBe(true)

    const profilesInA = await queryAs<{ id: string }>(client, users.adultA, 'select id from profiles')
    expect(profilesInA.map(row => row.id).sort()).toEqual([users.ownerA, users.adultA].sort())
  })

  it('shows invitations and job runs to no API role', async () => {
    expect(await queryAs(client, users.ownerA, 'select id from invitations')).toEqual([])
    expect(await queryAs(client, users.ownerA, 'select id from job_runs')).toEqual([])
  })

  it('keeps the audit log from members and viewers', async () => {
    expect(await queryAs(client, users.adultA, 'select id from audit_log')).not.toEqual([])
    await changeMemberRole(a, db, { userId: users.adultA, role: 'viewer' })
    try {
      expect(await queryAs(client, users.adultA, 'select id from audit_log')).toEqual([])
      expect(await queryAs(client, users.adultA, 'select id from households')).toHaveLength(1)
    } finally {
      await changeMemberRole(a, db, { userId: users.adultA, role: 'adult' })
    }
  })

  it('shows anon nothing', async () => {
    for (const table of ['households', 'household_members', 'profiles', 'audit_log']) {
      expect(await queryAs(client, null, `select 1 from ${table}`)).toEqual([])
    }
    await expect(queryAs(client, null, `select private.member_role('${a.householdId}')`)).rejects.toThrow(/permission denied/)
  })

  it('lets no API role write', async () => {
    await expect(
      queryAs(client, users.ownerA, "insert into households (name, timezone, currency) values ('Mine', 'UTC', 'USD')")
    ).rejects.toThrow(/row-level security/)
    expect(
      await queryAs(client, users.ownerA, `update household_members set role = 'owner' where user_id = '${users.adultA}' returning 1`)
    ).toEqual([])
  })
})
