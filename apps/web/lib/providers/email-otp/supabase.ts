import 'server-only'
import { createClient, type AuthError, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { EmailOtpError, type EmailOtpProvider, type VerifiedEmailUser } from './types'

// Supabase Auth, used only to prove who someone is. Every call gets a fresh client that keeps its
// session in memory and writes no cookies. verifyOtp answers with a Supabase session, which Ghar
// never stores or returns: it is signed out at once and the client is dropped.

const verifiedUserSchema = z.object({
  id: z.uuid(),
  email: z.string().optional(),
})

export function createSupabaseEmailOtpProvider(config: { url: string; publishableKey: string }): EmailOtpProvider {
  function client(): SupabaseClient {
    return createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        // The PKCE flow would need a code verifier kept between sending and verifying.
        flowType: 'implicit',
      },
    })
  }

  async function finishVerify(supabase: SupabaseClient, result: Awaited<ReturnType<SupabaseClient['auth']['verifyOtp']>>): Promise<VerifiedEmailUser> {
    if (result.error) throw verifyError(result.error)
    const parsed = verifiedUserSchema.safeParse(result.data.user)
    if (result.data.session) {
      // Ends the Supabase session verifyOtp just made, with that session's own token. Best effort:
      // it expires on its own, and nothing of it leaves this function.
      try {
        await supabase.auth.signOut({ scope: 'local' })
      } catch {
        // Ignored on purpose.
      }
    }
    if (!parsed.success) throw new EmailOtpError('unavailable', 'Supabase verified the code but sent no usable user.')
    return { userId: parsed.data.id, email: parsed.data.email ?? null }
  }

  return {
    async sendCode({ email, redirectTo }) {
      const { error } = await client().auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
      })
      if (error) throw sendError(error)
    },

    async verifyCode({ email, code }) {
      const supabase = client()
      return finishVerify(supabase, await supabase.auth.verifyOtp({ email, token: code, type: 'email' }))
    },

    async verifyTokenHash({ tokenHash, type }) {
      const supabase = client()
      return finishVerify(supabase, await supabase.auth.verifyOtp({ token_hash: tokenHash, type }))
    },
  }
}

function sendError(error: AuthError): EmailOtpError {
  switch (error.code) {
    case 'otp_disabled':
    case 'signup_disabled':
    case 'email_provider_disabled':
      return new EmailOtpError('disabled', 'Supabase refused to send a sign-in email. Turn on email sign-in and "Allow new users to sign up" in Supabase Auth.', { cause: describeAuthError(error) })
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return new EmailOtpError('rate_limited', 'Supabase is limiting sign-in emails.', { cause: describeAuthError(error) })
    case 'email_address_invalid':
    case 'email_address_not_authorized':
    case 'validation_failed':
      return new EmailOtpError('invalid_email', 'Supabase would not send to that address.', { cause: describeAuthError(error) })
    default:
      return new EmailOtpError(error.status === 429 ? 'rate_limited' : 'unavailable', 'Supabase could not send the sign-in email.', { cause: describeAuthError(error) })
  }
}

/**
 * The status and code only. Supabase's messages can repeat the email address, and the cause is
 * logged when the error reaches a route unhandled.
 */
function describeAuthError(error: AuthError): string {
  return `Supabase Auth answered ${error.status ?? 'without a status'} (${error.code ?? 'no code'})`
}

function verifyError(error: AuthError): EmailOtpError {
  if (error.code === 'over_request_rate_limit' || error.status === 429) {
    return new EmailOtpError('rate_limited', 'Supabase is limiting sign-in attempts.', { cause: describeAuthError(error) })
  }
  // otp_expired, validation_failed, user_banned and the rest of the 4xx answers: the code doesn't work.
  if (typeof error.status === 'number' && error.status >= 400 && error.status < 500) {
    return new EmailOtpError('rejected', 'Supabase did not accept the code.', { cause: describeAuthError(error) })
  }
  return new EmailOtpError('unavailable', 'Supabase could not check the code.', { cause: describeAuthError(error) })
}
