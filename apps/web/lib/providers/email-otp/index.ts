import 'server-only'
import { env } from '@/lib/env'
import { createSupabaseEmailOtpProvider } from './supabase'
import type { EmailOtpProvider } from './types'

export { createFakeEmailOtpProvider, fakeEmailOtpStore, FakeEmailOtpStore, type FakeSentCode } from './fake'
export { EmailOtpError, type EmailLinkType, type EmailOtpFailure, type EmailOtpProvider, type VerifiedEmailUser } from './types'

/**
 * Supabase Auth, always. Unlike the other providers there's no keyless fallback to choose: the
 * Supabase URL and publishable key are required everywhere, including local development. Tests
 * swap in createFakeEmailOtpProvider.
 */
export function getEmailOtpProvider(): EmailOtpProvider {
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = env()
  return createSupabaseEmailOtpProvider({ url: SUPABASE_URL, publishableKey: SUPABASE_PUBLISHABLE_KEY })
}
