import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * Turns an access token into a user id, and nothing else. The domain type is a user id;
 * the vendor's session shape never leaves this file.
 *
 * There are two implementations, as every adapter here has: the real one asks Supabase to
 * verify the token, and the fake one hands back a fixed user so the app runs locally
 * without keys. Which one you get is decided by env, once, at module load.
 */

export interface AuthenticatedUser {
  readonly id: string;
}

export interface AuthProvider {
  /** Null for a token that is missing, expired, or not ours. Never throws on a bad token. */
  userFromToken(token: string): Promise<AuthenticatedUser | null>;
  /** The signed-in user when there is no token to check. Only the fake has one. */
  developmentUser(): AuthenticatedUser | null;
}

/**
 * Verification happens on Supabase's side. Decoding the JWT here and trusting its `sub`
 * would accept anything shaped like a token, so this asks rather than reads.
 */
function realProvider(url: string, anonKey: string): AuthProvider {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    async userFromToken(token) {
      const { data, error } = await client.auth.getUser(token);
      if (error ?? !data.user) return null;
      return { id: data.user.id };
    },
    developmentUser: () => null,
  };
}

/**
 * For local development and tests. DEV_USER_ID is the household member you are signed in
 * as. It is read only when Supabase is not configured, so it cannot weaken a real
 * deployment: setting it in production does nothing.
 */
function fakeProvider(devUserId: string | undefined): AuthProvider {
  const user = devUserId ? { id: devUserId } : null;
  return {
    userFromToken: (token) => Promise.resolve(token === '' ? null : user),
    developmentUser: () => user,
  };
}

let provider: AuthProvider | undefined;

export function getAuthProvider(): AuthProvider {
  if (!provider) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    provider = url && anonKey ? realProvider(url, anonKey) : fakeProvider(process.env.DEV_USER_ID);
  }
  return provider;
}
