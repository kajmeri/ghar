import { describe, expect, it } from 'vitest';
import { ConflictError, ForbiddenError } from '../src/errors';
import {
  assertCanInvite,
  assertInvitationAcceptable,
  invitationExpiresAt,
  invitationStatus,
  normalizeEmail,
  type InvitationState,
} from '../src/invitations';

const now = new Date('2026-09-13T12:00:00.000Z');

describe('invitation lifetime', () => {
  it('expires seven days after it is sent', () => {
    expect(invitationExpiresAt(now).toISOString()).toBe('2026-09-20T12:00:00.000Z');
  });

  it('is pending until it expires or is used', () => {
    const expiresAt = invitationExpiresAt(now);
    expect(invitationStatus({ acceptedAt: null, expiresAt }, now)).toBe('pending');
    expect(invitationStatus({ acceptedAt: null, expiresAt }, expiresAt)).toBe('expired');
    expect(invitationStatus({ acceptedAt: now, expiresAt }, now)).toBe('accepted');
  });
});

describe('normalizeEmail', () => {
  it('trims and lower-cases', () => {
    expect(normalizeEmail('  Sam@Example.COM ')).toBe('sam@example.com');
  });
});

describe('assertCanInvite', () => {
  it.each([
    ['owner', 'adult'],
    ['owner', 'viewer'],
    ['adult', 'adult'],
    ['adult', 'member'],
  ] as const)('lets %s invite as %s', (role, invitedAs) => {
    expect(() => {
      assertCanInvite({ role }, invitedAs);
    }).not.toThrow();
  });

  it.each([
    ['owner', 'owner'],
    ['adult', 'owner'],
    ['member', 'viewer'],
    ['viewer', 'viewer'],
  ] as const)('refuses %s inviting as %s', (role, invitedAs) => {
    expect(() => {
      assertCanInvite({ role }, invitedAs);
    }).toThrow(ForbiddenError);
  });
});

describe('assertInvitationAcceptable', () => {
  const invitation: InvitationState = {
    email: 'sam@example.com',
    acceptedAt: null,
    expiresAt: invitationExpiresAt(now),
  };
  const accept =
    (
      overrides: Partial<typeof invitation> = {},
      acceptor: { email: string | null; hasHousehold: boolean } = {
        email: 'sam@example.com',
        hasHousehold: false,
      },
      at = now,
    ) =>
    () => {
      assertInvitationAcceptable({ ...invitation, ...overrides }, acceptor, at);
    };

  it('accepts a pending invitation for the signed-in address', () => {
    expect(accept()).not.toThrow();
  });

  it('matches the address without regard to case', () => {
    expect(accept({}, { email: 'SAM@example.com', hasHousehold: false })).not.toThrow();
  });

  it('is single-use', () => {
    expect(accept({ acceptedAt: now })).toThrow(ConflictError);
  });

  it('refuses an expired invitation', () => {
    expect(accept({}, undefined, invitation.expiresAt)).toThrow(ConflictError);
  });

  it('refuses a different address', () => {
    expect(accept({}, { email: 'alex@example.com', hasHousehold: false })).toThrow(ForbiddenError);
    expect(accept({}, { email: null, hasHousehold: false })).toThrow(ForbiddenError);
  });

  it('refuses someone already in a household', () => {
    expect(accept({}, { email: 'sam@example.com', hasHousehold: true })).toThrow(ConflictError);
  });
});
