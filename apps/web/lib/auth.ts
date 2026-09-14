import 'server-only';
import type { RequestContext } from '@casa/contracts';
import { UnauthorizedError } from '@casa/core/errors';
import { resolveContext, type Household } from '@casa/db/queries';
import { cookies, headers } from 'next/headers';
import { getDb } from './db';
import { getAuthProvider } from './providers/supabase-auth';

/**
 * Who is asking, and which household they are in.
 *
 * This is the only place a RequestContext is built. The household id comes from the
 * membership row for the session's user, never from a request body or query param, which
 * is what makes every query below it household-scoped by construction.
 *
 * Sign-in itself is not built yet: nothing here issues a token. Until the magic-link flow
 * lands, `DEV_USER_ID` stands in locally (see lib/providers/supabase-auth.ts), and the
 * token path below is what that flow will hand off to.
 */

export interface Session {
  readonly context: RequestContext;
  readonly household: Household;
}

/** Mobile sends a bearer token; the browser will send the cookie the sign-in flow sets. */
const SESSION_COOKIE = 'casa-session';

async function accessToken(): Promise<string | null> {
  const authorization = (await headers()).get('authorization');
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    return authorization.slice('bearer '.length).trim() || null;
  }
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export async function getSession(): Promise<Session | null> {
  const provider = getAuthProvider();
  const token = await accessToken();
  const user = token ? await provider.userFromToken(token) : provider.developmentUser();
  if (!user) return null;

  return resolveContext(getDb(), user.id);
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError('Sign in to see this');
  return session;
}
