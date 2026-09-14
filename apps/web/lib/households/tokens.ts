import 'server-only';
import { createHash, randomBytes } from 'node:crypto';

/**
 * The secret in an invitation link: 32 random bytes, base64url. Only its SHA-256 is stored, so a
 * database read can't be turned into a working link.
 */
export function createInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
