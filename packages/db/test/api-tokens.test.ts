import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { UnauthorizedError } from '@ghar/core/errors'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { apiTokens } from '../src/schema'
import {
  findApiTokenSession,
  findCurrentHousehold,
  issueApiToken,
  LAST_USED_RESOLUTION_MS,
  revokeApiTokenFamily,
  rotateApiToken,
  type NewApiTokenHashes,
} from '../src/queries/api-tokens'
import { createInvitation } from '../src/queries/invitations'
import { removeMember } from '../src/queries/members'
import { acceptInvitation, createHousehold } from '../src/queries/session'
import type { Db, SessionContext } from '../src/queries/types'
import { createAuthUser, createTestDatabase } from './support/database'

// Bearer tokens against the real schema: issuing, resolving, rotating, reuse, sign-out, and what
// leaving a household does to them. The tokens are made here the way apps/web makes them.

const HOUR = 3_600_000
const DAY = 24 * HOUR
const T0 = new Date()
const at = (ms: number) => new Date(T0.getTime() + ms)

let client: PGlite
let db: Db

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
})

function sha256(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function mint(now: Date): { accessToken: string; refreshToken: string; hashes: NewApiTokenHashes } {
  const accessToken = `ghar_at_${randomBytes(32).toString('base64url')}`
  const refreshToken = `ghar_rt_${randomBytes(32).toString('base64url')}`
  return {
    accessToken,
    refreshToken,
    hashes: {
      accessTokenHash: sha256(accessToken),
      refreshTokenHash: sha256(refreshToken),
      accessExpiresAt: new Date(now.getTime() + HOUR),
      refreshExpiresAt: new Date(now.getTime() + 60 * DAY),
    },
  }
}

async function newUser(label: string): Promise<SessionContext> {
  const email = `${label}-${randomUUID()}@example.com`
  return { userId: await createAuthUser(client, email), email }
}

async function issue(user: SessionContext, now = T0) {
  const pair = mint(now)
  const issued = await issueApiToken(user, db, { ...pair.hashes, now })
  return { ...pair, issued }
}

function resolve(accessToken: string, now: Date) {
  return findApiTokenSession(db, { accessTokenHash: sha256(accessToken), now })
}

function rotate(refreshToken: string, now: Date) {
  const pair = mint(now)
  return rotateApiToken(db, { refreshTokenHash: sha256(refreshToken), next: pair.hashes, now }).then(issued => ({ ...pair, issued }))
}

function familyRows(familyId: string) {
  return db.select().from(apiTokens).where(eq(apiTokens.familyId, familyId))
}

describe('issuing and resolving', () => {
  it('issues before onboarding with no household, and resolves to the person', async () => {
    const user = await newUser('new')
    const { accessToken, issued } = await issue(user)
    expect(issued.household).toBeNull()
    expect(issued.accessExpiresAt).toEqual(at(HOUR))

    const session = await resolve(accessToken, at(1000))
    expect(session).toMatchObject({ userId: user.userId, email: user.email, householdId: null, familyId: issued.familyId })
  })

  it('scopes the token to the household the person is in', async () => {
    const owner = await newUser('owner')
    const joined = await createHousehold(owner, db, { name: 'Token house', timezone: 'America/Chicago', currency: 'USD' })
    const { accessToken, issued } = await issue(owner)
    expect(issued.household).toEqual({ id: joined.household.id, name: 'Token house', role: 'owner' })
    expect((await resolve(accessToken, at(1000)))?.householdId).toBe(joined.household.id)
  })

  it('stores hashes only', async () => {
    const user = await newUser('hashes')
    const { accessToken, refreshToken, issued } = await issue(user)
    const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, issued.tokenId))
    expect(row?.accessTokenHash).toBe(sha256(accessToken))
    expect(row?.refreshTokenHash).toBe(sha256(refreshToken))
    const stored = JSON.stringify(row)
    for (const raw of [accessToken, refreshToken, accessToken.slice(8), refreshToken.slice(8)]) {
      expect(stored).not.toContain(raw)
    }
  })

  it('refuses an unknown token and an access token past its expiry', async () => {
    const user = await newUser('expiry')
    const { accessToken } = await issue(user)
    expect(await resolve(`ghar_at_${randomBytes(32).toString('base64url')}`, at(1000))).toBeNull()
    expect(await resolve(accessToken, at(HOUR - 1))).not.toBeNull()
    expect(await resolve(accessToken, at(HOUR))).toBeNull()
  })

  it('records use at most once a minute', async () => {
    const user = await newUser('last-used')
    const { accessToken, issued } = await issue(user)
    const lastUsed = async () => (await db.select({ lastUsedAt: apiTokens.lastUsedAt }).from(apiTokens).where(eq(apiTokens.id, issued.tokenId)))[0]?.lastUsedAt

    await resolve(accessToken, at(1000))
    expect(await lastUsed()).toEqual(at(1000))
    await resolve(accessToken, at(1000 + LAST_USED_RESOLUTION_MS - 1))
    expect(await lastUsed()).toEqual(at(1000))
    await resolve(accessToken, at(1000 + LAST_USED_RESOLUTION_MS))
    expect(await lastUsed()).toEqual(at(1000 + LAST_USED_RESOLUTION_MS))
  })
})

describe('refreshing', () => {
  it('rotates into the same family and ends the old pair', async () => {
    const user = await newUser('rotate')
    const first = await issue(user)
    const second = await rotate(first.refreshToken, at(10 * 60_000))

    expect(second.issued.familyId).toBe(first.issued.familyId)
    expect(second.issued.tokenId).not.toBe(first.issued.tokenId)
    expect(second.issued.email).toBe(user.email)
    expect(second.issued.accessExpiresAt).toEqual(at(10 * 60_000 + HOUR))

    expect(await resolve(first.accessToken, at(10 * 60_000))).toBeNull()
    expect((await resolve(second.accessToken, at(10 * 60_000)))?.userId).toBe(user.userId)
    const [old] = await db.select().from(apiTokens).where(eq(apiTokens.id, first.issued.tokenId))
    expect(old?.rotatedAt).toEqual(at(10 * 60_000))
    expect(old?.revokedAt).toBeNull()
  })

  it('rotates in the same instant the pair was issued', async () => {
    const user = await newUser('instant')
    const first = await issue(user)
    const second = await rotate(first.refreshToken, T0)
    expect(second.issued.familyId).toBe(first.issued.familyId)
  })

  it('picks up a household joined since the token was issued', async () => {
    const user = await newUser('onboarding')
    const first = await issue(user)
    expect(first.issued.household).toBeNull()
    const joined = await createHousehold(user, db, { name: 'Later house', timezone: 'Europe/Lisbon', currency: 'EUR' })

    const second = await rotate(first.refreshToken, at(60_000))
    expect(second.issued.household).toEqual({ id: joined.household.id, name: 'Later house', role: 'owner' })
    expect((await resolve(second.accessToken, at(60_000)))?.householdId).toBe(joined.household.id)
    expect(await findCurrentHousehold(user, db)).toEqual(second.issued.household)
  })

  it('refuses an unknown refresh token', async () => {
    await expect(rotate(`ghar_rt_${randomBytes(32).toString('base64url')}`, T0)).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('refuses an expired refresh token without revoking the family', async () => {
    const user = await newUser('refresh-expiry')
    const first = await issue(user)
    await expect(rotate(first.refreshToken, at(60 * DAY))).rejects.toBeInstanceOf(UnauthorizedError)
    const rows = await familyRows(first.issued.familyId)
    expect(rows.map(row => row.revokedAt)).toEqual([null])
  })

  it('treats a second use of a refresh token as theft and revokes the whole family', async () => {
    const user = await newUser('reuse')
    const first = await issue(user)
    const second = await rotate(first.refreshToken, at(60_000))

    await expect(rotate(first.refreshToken, at(120_000))).rejects.toBeInstanceOf(UnauthorizedError)

    const rows = await familyRows(first.issued.familyId)
    expect(rows).toHaveLength(2)
    expect(rows.every(row => row.revokedAt?.getTime() === at(120_000).getTime())).toBe(true)
    expect(await resolve(second.accessToken, at(120_000))).toBeNull()
    await expect(rotate(second.refreshToken, at(180_000))).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('leaves the person’s other devices alone when one family is revoked', async () => {
    const user = await newUser('two-devices')
    const phone = await issue(user)
    const tablet = await issue(user)
    await rotate(phone.refreshToken, at(60_000))
    await expect(rotate(phone.refreshToken, at(120_000))).rejects.toBeInstanceOf(UnauthorizedError)
    expect((await resolve(tablet.accessToken, at(120_000)))?.userId).toBe(user.userId)
  })
})

describe('signing out', () => {
  it('revokes the family, and only for its owner', async () => {
    const user = await newUser('sign-out')
    const stranger = await newUser('stranger')
    const first = await issue(user)
    const second = await rotate(first.refreshToken, at(60_000))

    expect(await revokeApiTokenFamily(stranger, db, { familyId: first.issued.familyId, now: at(90_000) })).toEqual({ revoked: 0 })
    expect(await resolve(second.accessToken, at(90_000))).not.toBeNull()

    expect(await revokeApiTokenFamily(user, db, { familyId: first.issued.familyId, now: at(90_000) })).toEqual({ revoked: 2 })
    expect(await resolve(second.accessToken, at(90_000))).toBeNull()
    await expect(rotate(second.refreshToken, at(120_000))).rejects.toBeInstanceOf(UnauthorizedError)
  })
})

describe('leaving a household', () => {
  it('deletes the member’s tokens for that household', async () => {
    const owner = await newUser('leaving-owner')
    const adult = await newUser('leaving-adult')
    const joined = await createHousehold(owner, db, { name: 'Leavers', timezone: 'America/Chicago', currency: 'USD' })
    const ownerCtx = { userId: owner.userId, householdId: joined.household.id, role: 'owner' as const }
    const tokenHash = `invite-${randomUUID()}`
    await createInvitation(ownerCtx, db, { email: adult.email ?? '', role: 'adult', tokenHash, expiresAt: invitationExpiresAt(T0) })
    await acceptInvitation(adult, db, { tokenHash, now: T0 })

    const adultToken = await issue(adult)
    const ownerToken = await issue(owner)
    expect(adultToken.issued.household?.id).toBe(joined.household.id)

    await removeMember(ownerCtx, db, { userId: adult.userId })

    expect(await familyRows(adultToken.issued.familyId)).toEqual([])
    expect(await resolve(adultToken.accessToken, at(1000))).toBeNull()
    await expect(rotate(adultToken.refreshToken, at(1000))).rejects.toBeInstanceOf(UnauthorizedError)
    expect((await resolve(ownerToken.accessToken, at(1000)))?.userId).toBe(owner.userId)
  })
})
