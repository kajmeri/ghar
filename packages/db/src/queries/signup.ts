import { normalizeEmail } from '@ghar/core/invitations'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { invitations } from '../schema'
import type { Db } from './types'

/**
 * Whether an address holds an invitation it could still accept. Sign-in asks before anyone is
 * signed in, so there is no context to take; the answer is yes or no and reveals nothing else.
 */
export async function hasOpenInvitation(db: Db, input: { email: string; now: Date }): Promise<boolean> {
  const [row] = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(and(eq(invitations.email, normalizeEmail(input.email)), isNull(invitations.acceptedAt), gt(invitations.expiresAt, input.now)))
    .limit(1)
  return row !== undefined
}
