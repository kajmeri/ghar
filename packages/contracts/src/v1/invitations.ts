import { z } from 'zod';
import { householdRoleSchema } from '../context';
import { defineEndpoint } from '../endpoint';
import { myHouseholdResponseSchema } from './households';

/** Nobody is invited as owner. An owner promotes them after they join. */
export const invitableRoleSchema = householdRoleSchema.exclude(['owner']);

export const invitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: householdRoleSchema,
  invitedByName: z.string().nullable(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type Invitation = z.infer<typeof invitationSchema>;

export const listInvitations = defineEndpoint({
  method: 'GET',
  path: '/api/v1/households/me/invitations',
  response: z.object({ invitations: z.array(invitationSchema) }),
});

export const createInvitationBodySchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
  role: invitableRoleSchema,
});
export type CreateInvitationBody = z.infer<typeof createInvitationBodySchema>;

/**
 * Owners and adults. Emails a single-use link that expires in seven days. Inviting an address
 * that already has a pending invitation replaces it, so the old link stops working.
 */
export const createInvitation = defineEndpoint({
  method: 'POST',
  path: '/api/v1/households/me/invitations',
  body: createInvitationBodySchema,
  response: z.object({ invitation: invitationSchema }),
});

export const revokeInvitation = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/households/me/invitations/:invitationId',
  params: z.object({ invitationId: z.uuid() }),
  response: z.object({ invitationId: z.uuid() }),
});

/** The token from the emailed link. Sent in a body, never a query string, to keep it out of logs. */
export const invitationTokenBodySchema = z.object({ token: z.string().min(32).max(128) });

export const invitationPreviewSchema = z.object({
  householdName: z.string(),
  email: z.string(),
  role: householdRoleSchema,
  invitedByName: z.string().nullable(),
  expiresAt: z.iso.datetime(),
  status: z.enum(['pending', 'accepted', 'expired']),
  /** Whether the signed-in address is the one invited. */
  forYou: z.boolean(),
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;

/** What the accept screen shows. 404 for an unknown token. */
export const previewInvitation = defineEndpoint({
  method: 'POST',
  path: '/api/v1/invitations/preview',
  body: invitationTokenBodySchema,
  response: z.object({ invitation: invitationPreviewSchema }),
});

/** Joins the household. The caller must be signed in with the invited address. */
export const acceptInvitation = defineEndpoint({
  method: 'POST',
  path: '/api/v1/invitations/accept',
  body: invitationTokenBodySchema,
  response: myHouseholdResponseSchema,
});
