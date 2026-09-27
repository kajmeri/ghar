import { z } from 'zod'
import { householdRoleSchema } from '../context'
import { defineEndpoint } from '../endpoint'
import { myHouseholdResponseSchema } from './households'
import { pageQuerySchema, pageSchema } from './shared'

/** Nobody is invited as owner. An owner promotes them after they join. */
export const invitableRoleSchema = householdRoleSchema.exclude(['owner'])

export const invitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: householdRoleSchema,
  invitedByName: z.string().nullable(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
})
export type Invitation = z.infer<typeof invitationSchema>

/** Invitations still waiting for an answer, newest first. */
export const listInvitations = defineEndpoint({
  method: 'GET',
  path: '/api/v1/households/me/invitations',
  query: pageQuerySchema,
  response: pageSchema(invitationSchema),
})

export const createInvitationBodySchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
  role: invitableRoleSchema,
})
export type CreateInvitationBody = z.infer<typeof createInvitationBodySchema>

export const createInvitationResponseSchema = z.object({
  invitation: invitationSchema,
  /** False when the email couldn't go out. The invitation still stands. */
  emailed: z.boolean(),
  /** The link to send them yourself when `emailed` is false. Null when it was emailed. */
  link: z.url().nullable(),
})
export type CreateInvitationResponse = z.infer<typeof createInvitationResponseSchema>

/**
 * Owners and adults. Emails a single-use link that expires in seven days. Inviting an address
 * that already has a pending invitation replaces it, so the old link stops working. When the email
 * can't be sent the invitation is still created, and the response carries the link instead.
 */
export const createInvitation = defineEndpoint({
  method: 'POST',
  path: '/api/v1/households/me/invitations',
  body: createInvitationBodySchema,
  response: createInvitationResponseSchema,
})

export const revokeInvitation = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/households/me/invitations/:invitationId',
  params: z.object({ invitationId: z.uuid() }),
  response: z.object({ invitationId: z.uuid() }),
})

/** The token from the emailed link. Sent in a body, never a query string, to keep it out of logs. */
export const invitationTokenBodySchema = z.object({ token: z.string().min(32).max(128) })

export const invitationPreviewSchema = z.object({
  householdName: z.string(),
  email: z.string(),
  role: householdRoleSchema,
  invitedByName: z.string().nullable(),
  expiresAt: z.iso.datetime(),
  status: z.enum(['pending', 'accepted', 'expired']),
  /** Whether the signed-in address is the one invited. */
  forYou: z.boolean(),
})
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>

/** What the accept screen shows. 404 for an unknown token. */
export const previewInvitation = defineEndpoint({
  method: 'POST',
  path: '/api/v1/invitations/preview',
  body: invitationTokenBodySchema,
  response: z.object({ invitation: invitationPreviewSchema }),
})

/** Joins the household. The caller must be signed in with the invited address. */
export const acceptInvitation = defineEndpoint({
  method: 'POST',
  path: '/api/v1/invitations/accept',
  body: invitationTokenBodySchema,
  response: myHouseholdResponseSchema,
})

/** An open invitation to the signed-in address, as it shows before someone has a household. */
export const myInvitationSchema = z.object({
  id: z.uuid(),
  householdName: z.string(),
  role: householdRoleSchema,
  invitedByName: z.string().nullable(),
  expiresAt: z.iso.datetime(),
})
export type MyInvitation = z.infer<typeof myInvitationSchema>

/**
 * Open invitations to the signed-in address, newest first, so someone who signs in without the
 * emailed link can still join. Needs a session but no household. Empty once they're in one.
 */
export const listMyInvitations = defineEndpoint({
  method: 'GET',
  path: '/api/v1/invitations/mine',
  response: z.object({ invitations: z.array(myInvitationSchema) }),
})

/** Joins the household from one of listMyInvitations. 404 unless it's open and to the signed-in address. */
export const acceptMyInvitation = defineEndpoint({
  method: 'POST',
  path: '/api/v1/invitations/:invitationId/accept',
  params: z.object({ invitationId: z.uuid() }),
  response: myHouseholdResponseSchema,
})
