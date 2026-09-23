import { requirePermission, type HouseholdRole } from '@ghar/core/auth'
import { ConflictError, NotFoundError } from '@ghar/core/errors'
import { assertCanInvite, normalizeEmail } from '@ghar/core/invitations'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { authUsers } from 'drizzle-orm/supabase'
import { householdMembers, invitations, profiles } from '../schema'
import { recordAudit } from './audit'
import { keysetAfter, keysetOrder, pageKeys, toPage, type Keyset, type Page, type PageRequest } from './pagination'
import type { Db, RequestContext } from './types'

export interface InvitationRow {
  id: string
  email: string
  role: HouseholdRole
  invitedByName: string | null
  expiresAt: Date
  createdAt: Date
}

const invitationColumns = {
  id: invitations.id,
  email: invitations.email,
  role: invitations.role,
  invitedByName: profiles.fullName,
  expiresAt: invitations.expiresAt,
  createdAt: invitations.createdAt,
}

function selectInvitations(db: Db) {
  return db.select(invitationColumns).from(invitations).leftJoin(profiles, eq(profiles.id, invitations.invitedBy))
}

/** Invitations not yet accepted, expired ones included so they can be sent again. */
export async function listPendingInvitations(ctx: RequestContext, db: Db): Promise<InvitationRow[]> {
  requirePermission(ctx, 'members.invite')
  return selectInvitations(db)
    .where(and(eq(invitations.householdId, ctx.householdId), isNull(invitations.acceptedAt)))
    .orderBy(desc(invitations.createdAt))
}

const invitationOrder: Keyset = { keys: [{ expr: invitations.createdAt, kind: 'timestamp', desc: true }], id: invitations.id, idDesc: true }

/** One page of listPendingInvitations: newest first, as there, with the id breaking ties. */
export async function listPendingInvitationsPage(ctx: RequestContext, db: Db, page: PageRequest): Promise<Page<InvitationRow>> {
  requirePermission(ctx, 'members.invite')
  const rows = await db
    .select({ ...invitationColumns, pageKeys: pageKeys(invitationOrder) })
    .from(invitations)
    .leftJoin(profiles, eq(profiles.id, invitations.invitedBy))
    .where(and(eq(invitations.householdId, ctx.householdId), isNull(invitations.acceptedAt), keysetAfter(invitationOrder, page.after)))
    .orderBy(...keysetOrder(invitationOrder))
    .limit(page.limit + 1)
  return toPage(rows, page.limit)
}

export interface NewInvitation {
  email: string
  role: HouseholdRole
  /** SHA-256 of the token in the emailed link. */
  tokenHash: string
  expiresAt: Date
}

/** Inviting an address with an open invitation replaces its role, token and expiry. */
export async function createInvitation(ctx: RequestContext, db: Db, input: NewInvitation): Promise<InvitationRow> {
  assertCanInvite(ctx, input.role)
  const email = normalizeEmail(input.email)

  return db.transaction(async tx => {
    const [existingMember] = await tx
      .select({ userId: householdMembers.userId })
      .from(householdMembers)
      .innerJoin(authUsers, eq(authUsers.id, householdMembers.userId))
      .where(and(eq(householdMembers.householdId, ctx.householdId), sql`lower(${authUsers.email}) = ${email}`))
      .limit(1)
    if (existingMember) throw new ConflictError(`${email} is already in your household.`)

    const values = {
      role: input.role,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      invitedBy: ctx.userId,
    }
    const [row] = await tx
      .insert(invitations)
      .values({ householdId: ctx.householdId, email, ...values })
      .onConflictDoUpdate({
        target: [invitations.householdId, invitations.email],
        targetWhere: isNull(invitations.acceptedAt),
        set: { ...values, createdAt: sql`now()` },
      })
      .returning({ id: invitations.id })
    if (!row) throw new Error('Invitation upsert returned no row')

    await recordAudit(ctx, tx, {
      action: 'invitation.sent',
      entity: 'invitation',
      entityId: row.id,
      metadata: { email, role: input.role },
    })

    const [invitation] = await selectInvitations(tx).where(eq(invitations.id, row.id)).limit(1)
    if (!invitation) throw new Error('Invitation vanished inside its own transaction')
    return invitation
  })
}

export async function revokeInvitation(ctx: RequestContext, db: Db, input: { invitationId: string }): Promise<{ invitationId: string }> {
  requirePermission(ctx, 'members.invite')
  return db.transaction(async tx => {
    const [row] = await tx
      .delete(invitations)
      .where(and(eq(invitations.id, input.invitationId), eq(invitations.householdId, ctx.householdId), isNull(invitations.acceptedAt)))
      .returning({ id: invitations.id, email: invitations.email })
    if (!row) throw new NotFoundError("That invitation doesn't exist or has already been used.")

    await recordAudit(ctx, tx, {
      action: 'invitation.revoked',
      entity: 'invitation',
      entityId: row.id,
      metadata: { email: row.email },
    })
    return { invitationId: row.id }
  })
}
