import type { HouseholdRole } from '@ghar/core/auth'
import { UnauthorizedError } from '@ghar/core/errors'
import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm'
import { authUsers } from 'drizzle-orm/supabase'
import { apiTokens, householdMembers, households, profiles } from '../schema'
import type { Db, SessionContext } from './types'

// Bearer tokens for the phone. apps/web/lib/auth/api-tokens.ts makes the tokens and hashes them;
// only the SHA-256 hashes reach this file. A family is every row descended from one sign-in by
// refreshing, so revoking a family signs that one device out.
//
// findApiTokenSession and rotateApiToken take no context, because the token is how the person is
// found. A row's household is the person's membership when the row was made. Leaving the household
// deletes the row (api_tokens_membership_fk cascades), and refreshing picks up a household joined since.

/** lastUsedAt is written at most this often per token, so a busy phone doesn't write on every request. */
export const LAST_USED_RESOLUTION_MS = 60_000

const REFRESH_REJECTED = 'This refresh token no longer works. Sign in again.'

export interface TokenHousehold {
  id: string
  name: string
  role: HouseholdRole
}

export interface NewApiTokenHashes {
  accessTokenHash: string
  refreshTokenHash: string
  accessExpiresAt: Date
  refreshExpiresAt: Date
}

export interface IssuedApiToken {
  tokenId: string
  familyId: string
  userId: string
  email: string | null
  household: TokenHousehold | null
  accessExpiresAt: Date
  refreshExpiresAt: Date
}

export interface ApiTokenSession {
  tokenId: string
  familyId: string
  userId: string
  /** From auth.users, never from the request. */
  email: string | null
  /** The household the token was issued for. Null before onboarding. */
  householdId: string | null
  accessExpiresAt: Date
}

/** The person's household and role now, or null before onboarding. */
export async function findCurrentHousehold(ctx: SessionContext, db: Db): Promise<TokenHousehold | null> {
  const [row] = await selectHousehold(ctx.userId, db)
  return row ?? null
}

/** A new family, after the person proved who they are with an emailed code or link. */
export async function issueApiToken(ctx: SessionContext, db: Db, input: NewApiTokenHashes & { now: Date }): Promise<IssuedApiToken> {
  const { now, ...hashes } = input
  return db.transaction(async tx => {
    // Someone signing in for the first time has no profile yet, and the token needs one.
    await tx.insert(profiles).values({ id: ctx.userId }).onConflictDoNothing({ target: profiles.id })
    const household = await lockedHousehold(ctx.userId, tx)
    const [row] = await tx
      .insert(apiTokens)
      .values({ familyId: sql`gen_random_uuid()`, userId: ctx.userId, householdId: household?.id ?? null, ...hashes, createdAt: now })
      .returning({ id: apiTokens.id, familyId: apiTokens.familyId })
    if (!row) throw new Error('API token insert returned no row')
    return { tokenId: row.id, familyId: row.familyId, userId: ctx.userId, email: ctx.email, household, ...expiries(hashes) }
  })
}

/**
 * The session behind an access token, or null when it's unknown, expired, rotated or revoked.
 * Records use at most once a minute.
 */
export async function findApiTokenSession(db: Db, input: { accessTokenHash: string; now: Date }): Promise<ApiTokenSession | null> {
  const [row] = await db
    .select({
      tokenId: apiTokens.id,
      familyId: apiTokens.familyId,
      userId: apiTokens.userId,
      email: authUsers.email,
      householdId: apiTokens.householdId,
      accessExpiresAt: apiTokens.accessExpiresAt,
      lastUsedAt: apiTokens.lastUsedAt,
    })
    .from(apiTokens)
    .leftJoin(authUsers, eq(authUsers.id, apiTokens.userId))
    .where(
      and(
        eq(apiTokens.accessTokenHash, input.accessTokenHash),
        isNull(apiTokens.revokedAt),
        isNull(apiTokens.rotatedAt),
        gt(apiTokens.accessExpiresAt, input.now)
      )
    )
    .limit(1)
  if (!row) return null

  const staleBefore = new Date(input.now.getTime() - LAST_USED_RESOLUTION_MS)
  if (row.lastUsedAt === null || row.lastUsedAt.getTime() <= staleBefore.getTime()) {
    // The condition is repeated in the update, so two requests racing each other write once.
    await db
      .update(apiTokens)
      .set({ lastUsedAt: input.now })
      .where(and(eq(apiTokens.id, row.tokenId), or(isNull(apiTokens.lastUsedAt), lte(apiTokens.lastUsedAt, staleBefore))))
  }

  return {
    tokenId: row.tokenId,
    familyId: row.familyId,
    userId: row.userId,
    email: row.email,
    householdId: row.householdId,
    accessExpiresAt: row.accessExpiresAt,
  }
}

/**
 * Trades a refresh token for a new pair in the same family, with the household read again from
 * the person's membership. A refresh token that was already rotated or revoked is being used a
 * second time, by a thief or by a client that raced itself, so the whole family is revoked. There
 * is no grace window: clients must never refresh concurrently.
 */
export async function rotateApiToken(db: Db, input: { refreshTokenHash: string; next: NewApiTokenHashes; now: Date }): Promise<IssuedApiToken> {
  const { now, next } = input
  // Returns instead of throwing inside the transaction, so revoking a family on reuse commits.
  const outcome = await db.transaction(async (tx): Promise<IssuedApiToken | null> => {
    const [current] = await tx
      .select({
        id: apiTokens.id,
        familyId: apiTokens.familyId,
        userId: apiTokens.userId,
        createdAt: apiTokens.createdAt,
        refreshExpiresAt: apiTokens.refreshExpiresAt,
        rotatedAt: apiTokens.rotatedAt,
        revokedAt: apiTokens.revokedAt,
      })
      .from(apiTokens)
      .where(eq(apiTokens.refreshTokenHash, input.refreshTokenHash))
      .limit(1)
      .for('update')
    if (!current) return null

    if (current.rotatedAt !== null || current.revokedAt !== null) {
      await tx
        .update(apiTokens)
        .set({ revokedAt: now })
        .where(and(eq(apiTokens.familyId, current.familyId), isNull(apiTokens.revokedAt)))
      return null
    }
    if (current.refreshExpiresAt.getTime() <= now.getTime()) return null

    // The old access token ends now too. The expiry check wants it after created_at, which a
    // refresh in the same millisecond as the sign-in would otherwise break.
    const accessEndsAt = new Date(Math.max(now.getTime(), current.createdAt.getTime() + 1))
    await tx.update(apiTokens).set({ rotatedAt: now, accessExpiresAt: accessEndsAt }).where(eq(apiTokens.id, current.id))

    const household = await lockedHousehold(current.userId, tx)
    const [row] = await tx
      .insert(apiTokens)
      .values({ familyId: current.familyId, userId: current.userId, householdId: household?.id ?? null, ...next, createdAt: now })
      .returning({ id: apiTokens.id })
    if (!row) throw new Error('API token insert returned no row')
    const [user] = await tx.select({ email: authUsers.email }).from(authUsers).where(eq(authUsers.id, current.userId)).limit(1)

    return {
      tokenId: row.id,
      familyId: current.familyId,
      userId: current.userId,
      email: user?.email ?? null,
      household,
      ...expiries(next),
    }
  })
  if (!outcome) throw new UnauthorizedError(REFRESH_REJECTED)
  return outcome
}

/** Sign-out: every token in one of the person's own families. Returns how many were still live. */
export async function revokeApiTokenFamily(ctx: SessionContext, db: Db, input: { familyId: string; now: Date }): Promise<{ revoked: number }> {
  const rows = await db
    .update(apiTokens)
    .set({ revokedAt: input.now })
    .where(and(eq(apiTokens.familyId, input.familyId), eq(apiTokens.userId, ctx.userId), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id })
  return { revoked: rows.length }
}

function selectHousehold(userId: string, db: Db) {
  return db
    .select({ id: households.id, name: households.name, role: householdMembers.role })
    .from(householdMembers)
    .innerJoin(households, eq(households.id, householdMembers.householdId))
    .where(eq(householdMembers.userId, userId))
    .limit(1)
}

/** Holds the membership until the transaction ends, so the token can't outlive a member leaving mid-insert. */
async function lockedHousehold(userId: string, tx: Db): Promise<TokenHousehold | null> {
  const [row] = await selectHousehold(userId, tx).for('key share', { of: householdMembers })
  return row ?? null
}

function expiries(hashes: NewApiTokenHashes): { accessExpiresAt: Date; refreshExpiresAt: Date } {
  return { accessExpiresAt: hashes.accessExpiresAt, refreshExpiresAt: hashes.refreshExpiresAt }
}
