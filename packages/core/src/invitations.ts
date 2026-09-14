import { addDays } from 'date-fns';
import {
  canInviteAs,
  requirePermission,
  type HouseholdRole,
  type RoleHolder,
} from './auth/permissions';
import { ConflictError, ForbiddenError } from './errors';

export const INVITATION_TTL_DAYS = 7;

export type InvitationStatus = 'pending' | 'accepted' | 'expired';

export interface InvitationState {
  readonly email: string;
  readonly acceptedAt: Date | null;
  readonly expiresAt: Date;
}

/** Emails are stored and compared trimmed and lower-cased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function invitationExpiresAt(now: Date): Date {
  return addDays(now, INVITATION_TTL_DAYS);
}

export function invitationStatus(
  invitation: Pick<InvitationState, 'acceptedAt' | 'expiresAt'>,
  now: Date,
): InvitationStatus {
  if (invitation.acceptedAt) return 'accepted';
  return invitation.expiresAt.getTime() <= now.getTime() ? 'expired' : 'pending';
}

/** Owners and adults invite. Nobody is invited as owner, and nobody above their own rank. */
export function assertCanInvite(actor: RoleHolder, role: HouseholdRole): void {
  requirePermission(actor, 'members.invite');
  if (role === 'owner') {
    throw new ForbiddenError(
      'People join as an adult, member or viewer. An owner can make them an owner after they join.',
    );
  }
  if (!canInviteAs(actor.role, role)) {
    throw new ForbiddenError(`Your role can't invite someone as ${role}.`);
  }
}

/**
 * An invitation is single-use, expires, and belongs to the address it was sent to. The person
 * accepting must be signed in with that address and not already in a household.
 */
export function assertInvitationAcceptable(
  invitation: InvitationState,
  acceptor: { email: string | null | undefined; hasHousehold: boolean },
  now: Date,
): void {
  const status = invitationStatus(invitation, now);
  if (status === 'accepted') {
    throw new ConflictError('This invitation has already been used.');
  }
  if (status === 'expired') {
    throw new ConflictError('This invitation has expired. Ask for a new one.');
  }
  if (!acceptor.email || normalizeEmail(acceptor.email) !== normalizeEmail(invitation.email)) {
    throw new ForbiddenError(
      `This invitation is for ${invitation.email}. Sign in with that address to accept it.`,
    );
  }
  if (acceptor.hasHousehold) {
    throw new ConflictError("You're already in a household. Ghar allows one per person.");
  }
}
