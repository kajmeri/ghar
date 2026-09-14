import 'server-only';
import { ValidationError } from '@ghar/core/errors';
import { safeRedirectPath } from '@ghar/core/redirects';
import { hasOpenInvitation } from '@ghar/db/queries';
import { getDb } from '@/lib/db';
import { env } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Emails a magic link. Ghar has no public signup, so Supabase may create an account only for
 * an address in SIGNUP_EMAILS or one holding an open invitation. Anyone else gets the same
 * reply as a successful send, so the form doesn't reveal who has an account.
 */
export async function sendSignInLink(input: { email: string; next?: string }): Promise<void> {
  const { APP_URL, SIGNUP_EMAILS } = env();
  const mayCreateAccount =
    SIGNUP_EMAILS.has(input.email) ||
    (await hasOpenInvitation(getDb(), { email: input.email, now: new Date() }));

  const callback = new URL('/auth/callback', APP_URL);
  // Always present, so the email template can append its own parameters with &.
  callback.searchParams.set('next', safeRedirectPath(input.next));

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: input.email,
    options: { emailRedirectTo: callback.toString(), shouldCreateUser: mayCreateAccount },
  });
  if (!error) return;

  switch (error.code) {
    case 'otp_disabled':
    case 'signup_disabled':
      console.info('[auth] No sign-in link sent: the address has no account or invitation.');
      return;
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      throw new ValidationError('Too many sign-in emails. Wait a minute, then try again.');
    case 'email_address_invalid':
      throw new ValidationError('Enter a valid email address.', {
        details: [{ path: ['email'], message: 'Enter a valid email address.' }],
      });
    default:
      throw new Error('Supabase could not send the sign-in link', { cause: error });
  }
}
