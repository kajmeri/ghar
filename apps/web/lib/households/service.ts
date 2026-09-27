import 'server-only'
import type {
  CreateHouseholdBody,
  CreateInvitationBody,
  CreateInvitationResponse,
  Household,
  Invitation,
  InvitationPreview,
  Member,
  MyHouseholdResponse,
  MyInvitation,
  PageQuery,
  RequestContext,
} from '@ghar/contracts'
import type { HouseholdRole } from '@ghar/core/auth'
import { invitationExpiresAt, invitationStatus } from '@ghar/core/invitations'
import * as queries from '@ghar/db/queries'
import type { SessionContext } from '@ghar/db/queries'
import { pageRequest, pageResponse, type PageResult } from '@/lib/api/cursor'
import { getDb } from '@/lib/db'
import { invitationEmail } from '@/lib/email/invitation'
import { env } from '@/lib/env'
import { getEmailProvider } from '@/lib/providers/email'
import { getMonitoring } from '@/lib/providers/monitoring'
import { currentHousehold } from './current'
import { createInvitationToken, hashInvitationToken } from './tokens'

// Household management, shared by app/api/v1 and the web's server actions so both run the same
// code. The rules live in @ghar/core and @ghar/db; this adds tokens and email, and turns rows
// into contract shapes.

export async function getMyHousehold(ctx: RequestContext, session: SessionContext): Promise<MyHouseholdResponse> {
  return toMyHousehold(await currentHousehold(ctx), session, ctx.role)
}

export async function createHousehold(session: SessionContext, body: CreateHouseholdBody): Promise<MyHouseholdResponse> {
  const { household, membership } = await queries.createHousehold(session, getDb(), body)
  return toMyHousehold(household, session, membership.role)
}

export async function listMembers(ctx: RequestContext): Promise<Member[]> {
  const rows = await queries.listMembers(ctx, getDb())
  return rows.map(toMember)
}

/** A page of members for the API, in the order they joined. */
export async function listMembersPage(ctx: RequestContext, query: PageQuery): Promise<PageResult<Member>> {
  const scope = { sort: 'members:joined' }
  const page = await queries.listMembersPage(ctx, getDb(), pageRequest(query, scope))
  return pageResponse(page, scope, toMember)
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

/** A page of invitations still waiting for an answer, newest first. */
export async function listInvitationsPage(ctx: RequestContext, query: PageQuery): Promise<PageResult<Invitation>> {
  const scope = { sort: 'invitations:created-desc' }
  const page = await queries.listPendingInvitationsPage(ctx, getDb(), pageRequest(query, scope))
  return pageResponse(page, scope, toInvitation)
}

/**
 * Creates or replaces the invitation, then emails the link. Only the token's hash is stored. When
 * the email can't go out the invitation still stands, and the link comes back for the inviter to
 * send themselves.
 */
export async function inviteMember(
  ctx: RequestContext,
  session: SessionContext,
  body: CreateInvitationBody
): Promise<CreateInvitationResponse> {
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
  const link = url.toString()
  try {
    await getEmailProvider().send(
      invitationEmail({
        to: invitation.email,
        householdName: household.name,
        inviterName: invitation.invitedByName ?? session.email ?? 'Someone in your household',
        role: invitation.role,
        url: link,
      })
    )
  } catch (error) {
    // Email is down or misconfigured. Worth knowing about, but not worth losing the invitation.
    getMonitoring().captureException(error, { level: 'warning', tags: { stage: 'invitation_email' } })
    return { invitation: toInvitation(invitation), emailed: false, link }
  }
  return { invitation: toInvitation(invitation), emailed: true, link: null }
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

/** Open invitations to the signed-in address. None once they're in a household, since they couldn't accept one. */
export async function listMyInvitations(session: SessionContext): Promise<MyInvitation[]> {
  const db = getDb()
  if (await queries.findMembership(session, db)) return []
  const rows = await queries.listOpenInvitations(session, db, { now: new Date() })
  return rows.map(row => ({ ...row, expiresAt: row.expiresAt.toISOString() }))
}

/** Accepts one of listMyInvitations by id, for someone who signed in without the emailed link. */
export async function acceptMyInvitation(session: SessionContext, invitationId: string): Promise<MyHouseholdResponse> {
  const { household, membership } = await queries.acceptInvitation(session, getDb(), { invitationId, now: new Date() })
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
