import type { HouseholdRole } from '@ghar/core/auth'
import { ConflictError, NotFoundError } from '@ghar/core/errors'
import { validateHouseholdSettings, type HouseholdSettings } from '@ghar/core/households'
import { assertInvitationAcceptable, normalizeEmail } from '@ghar/core/invitations'
import { and, desc, eq, gt, isNull, type SQL } from 'drizzle-orm'
import { householdMembers, households, invitations, profiles } from '../schema'
import { addMemberPerson } from './people'
import { recordAudit } from './audit'
import { ensureDefaultCategories } from './finances'
import type { HouseholdRow } from './households'
import { isUniqueViolation } from './pg-errors'
import type { Db, SessionContext } from './types'

// The only queries that take a SessionContext instead of a RequestContext. Each one resolves
// the household for a session, is how a session comes to have one, or touches only the
// person's own profile.

export interface Membership {
  householdId: string
  role: HouseholdRole
}

export interface JoinedHousehold {
  household: HouseholdRow
  membership: Membership
}

const ALREADY_IN_HOUSEHOLD = "You're already in a household. Ghar allows one per person."
const INVALID_INVITATION = "This invitation link isn't valid. Ask whoever invited you for a new one."

export async function findMembership(ctx: SessionContext, db: Db): Promise<Membership | null> {
  const [membership] = await db
    .select({ householdId: householdMembers.householdId, role: householdMembers.role })
    .from(householdMembers)
    .where(eq(householdMembers.userId, ctx.userId))
    .limit(1)
  return membership ?? null
}

/** Onboarding: creates the household and makes the signed-in person its owner. */
export async function createHousehold(ctx: SessionContext, db: Db, input: HouseholdSettings): Promise<JoinedHousehold> {
  const settings = validateHouseholdSettings(input)
  try {
    return await db.transaction(async tx => {
      if (await findMembership(ctx, tx)) throw new ConflictError(ALREADY_IN_HOUSEHOLD)
      await ensureProfile(ctx, tx)

      const [household] = await tx.insert(households).values(settings).returning()
      if (!household) throw new Error('Household insert returned no row')
      await tx.insert(householdMembers).values({ householdId: household.id, userId: ctx.userId, role: 'owner' })
      await addMemberPerson(tx, { householdId: household.id, userId: ctx.userId })

      const membership = { householdId: household.id, role: 'owner' } as const
      const owner = { userId: ctx.userId, ...membership }
      await ensureDefaultCategories(owner, tx)
      await recordAudit(owner, tx, {
        action: 'household.created',
        entity: 'household',
        entityId: household.id,
      })
      return { household, membership }
    })
  } catch (error) {
    // Two onboarding submissions racing each other.
    if (isUniqueViolation(error, 'household_members_user_id_unique')) {
      throw new ConflictError(ALREADY_IN_HOUSEHOLD)
    }
    throw error
  }
}

export interface InvitationPreviewRow {
  householdName: string
  email: string
  role: HouseholdRole
  invitedByName: string | null
  expiresAt: Date
  acceptedAt: Date | null
  /** Whether the signed-in address is the one invited. */
  forYou: boolean
}

export async function previewInvitation(ctx: SessionContext, db: Db, input: { tokenHash: string }): Promise<InvitationPreviewRow> {
  const [row] = await db
    .select({
      householdName: households.name,
      email: invitations.email,
      role: invitations.role,
      invitedByName: profiles.fullName,
      expiresAt: invitations.expiresAt,
      acceptedAt: invitations.acceptedAt,
    })
    .from(invitations)
    .innerJoin(households, eq(households.id, invitations.householdId))
    .leftJoin(profiles, eq(profiles.id, invitations.invitedBy))
    .where(eq(invitations.tokenHash, input.tokenHash))
    .limit(1)
  if (!row) throw new NotFoundError(INVALID_INVITATION)
  return { ...row, forYou: ctx.email !== null && normalizeEmail(ctx.email) === row.email }
}

export interface OpenInvitationRow {
  id: string
  householdName: string
  role: HouseholdRole
  invitedByName: string | null
  expiresAt: Date
}

/**
 * Open invitations to the signed-in address, newest first, for someone who signs in without the
 * emailed link. Empty without an email on the session.
 */
export async function listOpenInvitations(ctx: SessionContext, db: Db, input: { now: Date }): Promise<OpenInvitationRow[]> {
  if (!ctx.email) return []
  return db
    .select({
      id: invitations.id,
      householdName: households.name,
      role: invitations.role,
      invitedByName: profiles.fullName,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .innerJoin(households, eq(households.id, invitations.householdId))
    .leftJoin(profiles, eq(profiles.id, invitations.invitedBy))
    .where(and(eq(invitations.email, normalizeEmail(ctx.email)), isNull(invitations.acceptedAt), gt(invitations.expiresAt, input.now)))
    .orderBy(desc(invitations.createdAt))
}

/**
 * Which invitation to accept: the token's hash from the emailed link, or an id from
 * listOpenInvitations. An id only finds an invitation to the signed-in address, so someone else's
 * id reads as missing rather than naming who it was for.
 */
export type InvitationLookup = { tokenHash: string } | { invitationId: string }

function lookupCondition(ctx: SessionContext, lookup: InvitationLookup): SQL | undefined {
  if ('tokenHash' in lookup) return eq(invitations.tokenHash, lookup.tokenHash)
  if (!ctx.email) return undefined
  return and(eq(invitations.id, lookup.invitationId), eq(invitations.email, normalizeEmail(ctx.email)))
}

/** Joins the household the invitation is for. Single use. */
export async function acceptInvitation(ctx: SessionContext, db: Db, input: InvitationLookup & { now: Date }): Promise<JoinedHousehold> {
  const condition = lookupCondition(ctx, input)
  if (!condition) throw new NotFoundError(INVALID_INVITATION)
  try {
    return await db.transaction(async tx => {
      const [invitation] = await tx.select().from(invitations).where(condition).limit(1).for('update')
      if (!invitation) throw new NotFoundError(INVALID_INVITATION)

      const existing = await findMembership(ctx, tx)
      assertInvitationAcceptable(invitation, { email: ctx.email, hasHousehold: existing !== null }, input.now)

      await ensureProfile(ctx, tx)
      await tx.insert(householdMembers).values({
        householdId: invitation.householdId,
        userId: ctx.userId,
        role: invitation.role,
      })
      await addMemberPerson(tx, { householdId: invitation.householdId, userId: ctx.userId })
      await tx.update(invitations).set({ acceptedAt: input.now }).where(eq(invitations.id, invitation.id))

      const membership = { householdId: invitation.householdId, role: invitation.role }
      await recordAudit({ userId: ctx.userId, ...membership }, tx, {
        action: 'invitation.accepted',
        entity: 'invitation',
        entityId: invitation.id,
        metadata: { role: invitation.role },
      })

      const [household] = await tx.select().from(households).where(eq(households.id, invitation.householdId)).limit(1)
      if (!household) throw new NotFoundError('That household no longer exists.')
      return { household, membership }
    })
  } catch (error) {
    if (isUniqueViolation(error, 'household_members_user_id_unique')) {
      throw new ConflictError(ALREADY_IN_HOUSEHOLD)
    }
    throw error
  }
}

/** Sets the signed-in person's display name, creating their profile if it doesn't exist. */
export async function updateProfile(ctx: SessionContext, db: Db, input: { fullName: string | null }): Promise<void> {
  await db
    .insert(profiles)
    .values({ id: ctx.userId, fullName: input.fullName })
    .onConflictDoUpdate({ target: profiles.id, set: { fullName: input.fullName } })
}

export async function ensureProfile(ctx: SessionContext, db: Db): Promise<void> {
  await db.insert(profiles).values({ id: ctx.userId }).onConflictDoNothing({ target: profiles.id })
}
