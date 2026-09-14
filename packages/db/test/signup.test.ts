import { invitationExpiresAt } from '@ghar/core/invitations';
import { beforeAll, describe, expect, it } from 'vitest';
import { createInvitation } from '../src/queries/invitations';
import { acceptInvitation, createHousehold } from '../src/queries/session';
import { hasOpenInvitation } from '../src/queries/signup';
import type { Db } from '../src/queries/types';
import { createAuthUser, createTestDatabase } from './support/database';

const now = new Date();
let db: Db;

beforeAll(async () => {
  const test = await createTestDatabase();
  db = test.db;
  const owner = await createAuthUser(test.client, 'owner@example.com');
  const { household } = await createHousehold({ userId: owner, email: 'owner@example.com' }, db, {
    name: 'Signup household',
    timezone: 'UTC',
    currency: 'USD',
  });
  const ctx = { userId: owner, householdId: household.id, role: 'owner' } as const;

  const invite = (email: string, expiresAt: Date) =>
    createInvitation(ctx, db, { email, role: 'member', tokenHash: `hash-${email}`, expiresAt });
  await invite('open@example.com', invitationExpiresAt(now));
  await invite('expired@example.com', new Date(now.getTime() - 1000));
  await invite('accepted@example.com', invitationExpiresAt(now));

  const accepted = await createAuthUser(test.client, 'accepted@example.com');
  await acceptInvitation({ userId: accepted, email: 'accepted@example.com' }, db, {
    tokenHash: 'hash-accepted@example.com',
    now,
  });
});

describe('hasOpenInvitation', () => {
  it('is true for an address with a pending invitation, in any letter case', async () => {
    await expect(hasOpenInvitation(db, { email: 'open@example.com', now })).resolves.toBe(true);
    await expect(hasOpenInvitation(db, { email: ' Open@Example.com ', now })).resolves.toBe(true);
  });

  it('is false once the invitation has expired or been accepted', async () => {
    await expect(hasOpenInvitation(db, { email: 'expired@example.com', now })).resolves.toBe(false);
    await expect(hasOpenInvitation(db, { email: 'accepted@example.com', now })).resolves.toBe(
      false,
    );
  });

  it('is false for an address nobody invited', async () => {
    await expect(hasOpenInvitation(db, { email: 'stranger@example.com', now })).resolves.toBe(
      false,
    );
  });
});
