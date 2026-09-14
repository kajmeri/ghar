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

export function usesFakeCalendar(): boolean {
  return env().CALENDAR_PROVIDER === 'fake'
}

export function getGoogleCalendarClient(): GoogleCalendarClient {
  const { CALENDAR_PROVIDER, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = env()
  if (CALENDAR_PROVIDER === 'fake') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CALENDAR_PROVIDER is fake, and production cannot link a made-up calendar.')
    }
    return createFakeGoogleCalendarClient()
  }
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error('CALENDAR_PROVIDER is google, but GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not set.')
  }
  return createGoogleCalendarClient({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
  })
}
