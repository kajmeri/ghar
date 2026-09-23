import 'server-only'
import { env } from '@/lib/env'
import { createFakeGmailClient } from './fake'
import { createGmailClient } from './google'
import type { GmailClient } from './types'

export { createFakeGmailClient, FAKE_GMAIL_ACCOUNT, fakeGmailStore, FakeGmailStore, seedSampleMessages } from './fake'
export { GMAIL_READ_SCOPE } from './google'
export { MailAuthError, MailProviderError, type GmailAccount, type GmailClient, type MailMessage, type MessageIdListing } from './types'

/** Without a Google OAuth client, local development links a made-up inbox. */
export function usesFakeGmail(): boolean {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = env()
  return !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET
}

export function getGmailClient(): GmailClient {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = env()
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not set, and production cannot link a made-up inbox.')
    }
    return createFakeGmailClient()
  }
  return createGmailClient({ clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET })
}
