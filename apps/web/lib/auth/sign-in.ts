import 'server-only'
import { ValidationError } from '@ghar/core/errors'
import { safeRedirectPath } from '@ghar/core/redirects'
import { env } from '@/lib/env'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Emails a magic link. Anyone may sign up: Supabase creates the account on the first link, and
 * the person makes or joins a household after signing in.
 */
export async function sendSignInLink(input: { email: string; next?: string }): Promise<void> {
  const callback = new URL('/auth/callback', env().APP_URL)
  // Always present, so the email template can append its own parameters with &.
  callback.searchParams.set('next', safeRedirectPath(input.next))

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signInWithOtp({
    email: input.email,
    options: { emailRedirectTo: callback.toString(), shouldCreateUser: true },
  })
  if (!error) return

  switch (error.code) {
    case 'otp_disabled':
    case 'signup_disabled':
      throw new Error('Supabase refused to create an account. Turn on "Allow new users to sign up" in Supabase Auth.', { cause: error })
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      throw new ValidationError('Too many sign-in emails. Wait a minute, then try again.')
    case 'email_address_invalid':
      throw new ValidationError('Enter a valid email address.', {
        details: [{ path: ['email'], message: 'Enter a valid email address.' }],
      })
    default:
      throw new Error('Supabase could not send the sign-in link', { cause: error })
  }
}
