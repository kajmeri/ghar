import 'server-only'
import type {
  CreateHouseholdBody,
  CreateInvitationBody,
  Household,
  Invitation,
  InvitationPreview,
  Member,
  MyHouseholdResponse,
  RequestContext,
} from '@ghar/contracts'
import type { HouseholdRole } from '@ghar/core/auth'
import { invitationExpiresAt, invitationStatus } from '@ghar/core/invitations'
import * as queries from '@ghar/db/queries'
import type { SessionContext } from '@ghar/db/queries'
import { getDb } from '@/lib/db'
import { invitationEmail } from '@/lib/email/invitation'
import { env } from '@/lib/env'
import { getEmailProvider } from '@/lib/providers/email'
import { createInvitationToken, hashInvitationToken } from './tokens'

// Household management, shared by app/api/v1 and the web's server actions so both run the same
// code. The rules live in @ghar/core and @ghar/db; this adds tokens and email, and turns rows
// into contract shapes.

export async function getMyHousehold(ctx: RequestContext, session: SessionContext): Promise<MyHouseholdResponse> {
  const household = await queries.getHousehold(ctx, getDb())
  return toMyHousehold(household, session, ctx.role)
}

export async function createHousehold(session: SessionContext, body: CreateHouseholdBody): Promise<MyHouseholdResponse> {
  const { household, membership } = await queries.createHousehold(session, getDb(), body)
  return toMyHousehold(household, session, membership.role)
}

export async function listMembers(ctx: RequestContext): Promise<Member[]> {
  const rows = await queries.listMembers(ctx, getDb())
  return rows.map(toMember)
}

export async function changeMemberRole(ctx: RequestContext, input: { userId: string; role: HouseholdRole }): Promise<Member> {
  return toMember(await queries.changeMemberRole(ctx, getDb(), input))
}

export async function removeMember(ctx: RequestContext, input: { userId: string }): Promise<{ userId: string }> {
  return queries.removeMember(ctx, getDb(), input)
}

export async function listInvitations(ctx: RequestContext): Promise<Invitation[]> {
  const rows = await queries.listPendingInvitations(ctx, getDb())
  return rows.map(toInvitation)
}

/** Creates or replaces the invitation, then emails the link. Only the token's hash is stored. */
export async function inviteMember(ctx: RequestContext, session: SessionContext, body: CreateInvitationBody): Promise<Invitation> {
  const db = getDb()
  const { token, tokenHash } = createInvitationToken()
  const invitation = await queries.createInvitation(ctx, db, {
    email: body.email,
    role: body.role,
    tokenHash,
    expiresAt: invitationExpiresAt(new Date()),
  })
  const household = await queries.getHousehold(ctx, db)

  const url = new URL('/invite', env().APP_URL)
  url.searchParams.set('token', token)
  await getEmailProvider().send(
    invitationEmail({
      to: invitation.email,
      householdName: household.name,
      inviterName: invitation.invitedByName ?? session.email ?? 'Someone in your household',
      role: invitation.role,
      url: url.toString(),
    })
  )
  return toInvitation(invitation)
}

export async function revokeInvitation(ctx: RequestContext, input: { invitationId: string }): Promise<{ invitationId: string }> {
  return queries.revokeInvitation(ctx, getDb(), input)
}

export async function previewInvitation(session: SessionContext, token: string): Promise<InvitationPreview> {
  const row = await queries.previewInvitation(session, getDb(), {
    tokenHash: hashInvitationToken(token),
  })
  return {
    householdName: row.householdName,
    email: row.email,
    role: row.role,
    invitedByName: row.invitedByName,
    expiresAt: row.expiresAt.toISOString(),
    status: invitationStatus(row, new Date()),
    forYou: row.forYou,
  }
}

export async function acceptInvitation(session: SessionContext, token: string): Promise<MyHouseholdResponse> {
  const { household, membership } = await queries.acceptInvitation(session, getDb(), {
    tokenHash: hashInvitationToken(token),
    now: new Date(),
  })
  return toMyHousehold(household, session, membership.role)
}

function toHousehold(row: queries.HouseholdRow): Household {
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
  }
}

function toMyHousehold(household: queries.HouseholdRow, session: SessionContext, role: HouseholdRole): MyHouseholdResponse {
  return {
    household: toHousehold(household),
    me: { userId: session.userId, email: session.email, role },
  }
}

function toMember(row: queries.MemberRow): Member {
  return { ...row, joinedAt: row.joinedAt.toISOString() }
}

function toInvitation(row: queries.InvitationRow): Invitation {
  return {
    ...row,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }
}
