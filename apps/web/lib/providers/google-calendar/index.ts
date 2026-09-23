import 'server-only'
import { env } from '@/lib/env'
import { createFakeGoogleCalendarClient } from './fake'
import { createGoogleCalendarClient } from './google'
import type { GoogleCalendarClient } from './types'

export { createFakeGoogleCalendarClient, FAKE_GOOGLE_ACCOUNT, fakeGoogleCalendarStore, FakeGoogleCalendarStore } from './fake'
export {
  CalendarAuthError,
  CalendarProviderError,
  SyncTokenExpiredError,
  type CalendarChanges,
  type GoogleAccount,
  type GoogleCalendarClient,
  type ListChangesInput,
} from './types'

/** Without a Google OAuth client, local development links a made-up calendar. */
export function usesFakeCalendar(): boolean {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = env()
  return !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET
}

export function getGoogleCalendarClient(): GoogleCalendarClient {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = env()
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not set, and production cannot link a made-up calendar.')
    }
    return createFakeGoogleCalendarClient()
  }
  return createGoogleCalendarClient({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
  })
}
