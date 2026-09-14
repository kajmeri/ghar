import { describe, expect, it } from 'vitest';
import { assertCanChangeRole, assertCanRemoveMember, type MemberRef } from '../src/auth/membership';
import { ConflictError, ForbiddenError, NotFoundError } from '../src/errors';

const owner: MemberRef = { userId: 'owner', role: 'owner' };
const adult: MemberRef = { userId: 'adult', role: 'adult' };
const member: MemberRef = { userId: 'member', role: 'member' };
const household = [owner, adult, member];

describe('assertCanChangeRole', () => {
  it('lets an owner change someone else and returns them', () => {
    expect(
      assertCanChangeRole({
        actor: owner,
        members: household,
        targetUserId: 'adult',
        role: 'viewer',
      }),
    ).toEqual(adult);
  });

  it('lets an owner promote someone to owner', () => {
    expect(() =>
      assertCanChangeRole({
        actor: owner,
        members: household,
        targetUserId: 'member',
        role: 'owner',
      }),
    ).not.toThrow();
  });

  it('refuses adults', () => {
    expect(() =>
      assertCanChangeRole({
        actor: adult,
        members: household,
        targetUserId: 'member',
        role: 'viewer',
      }),
    ).toThrow(ForbiddenError);
  });

  it("refuses changing one's own role", () => {
    expect(() =>
      assertCanChangeRole({
        actor: owner,
        members: household,
        targetUserId: 'owner',
        role: 'adult',
      }),
    ).toThrow(ForbiddenError);
  });

  it('refuses someone outside the household', () => {
    expect(() =>
      assertCanChangeRole({
        actor: owner,
        members: household,
        targetUserId: 'stranger',
        role: 'adult',
      }),
    ).toThrow(NotFoundError);
  });

  it('never leaves the household without an owner', () => {
    // The actor's session says owner, but the rows read under lock show they were demoted.
    const members = [
      { userId: 'owner', role: 'adult' },
      { userId: 'other', role: 'owner' },
    ] as const;
    expect(() =>
      assertCanChangeRole({ actor: owner, members, targetUserId: 'other', role: 'adult' }),
    ).toThrow(ConflictError);
  });
});

describe('assertCanRemoveMember', () => {
  it('lets an owner remove someone else and returns them', () => {
    expect(
      assertCanRemoveMember({ actor: owner, members: household, targetUserId: 'member' }),
    ).toEqual(member);
  });

  it('refuses adults', () => {
    expect(() =>
      assertCanRemoveMember({ actor: adult, members: household, targetUserId: 'member' }),
    ).toThrow(ForbiddenError);
  });

  it('refuses removing yourself', () => {
    expect(() =>
      assertCanRemoveMember({ actor: owner, members: household, targetUserId: 'owner' }),
    ).toThrow(ForbiddenError);
  });

  it('refuses someone outside the household', () => {
    expect(() =>
      assertCanRemoveMember({ actor: owner, members: household, targetUserId: 'stranger' }),
    ).toThrow(NotFoundError);
  });

  it('never removes the last owner', () => {
    const members = [
      { userId: 'owner', role: 'adult' },
      { userId: 'other', role: 'owner' },
    ] as const;
    expect(() => assertCanRemoveMember({ actor: owner, members, targetUserId: 'other' })).toThrow(
      ConflictError,
    );
  });
});
