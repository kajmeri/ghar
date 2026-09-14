import 'server-only'
import { randomUUID } from 'node:crypto'
import { allDayInstant, type ExternalEvent, type ExternalEventChange } from '@ghar/core/calendar'
import { addCalendarDays } from '@ghar/core/dates'
import { CalendarAuthError, SyncTokenExpiredError, type CalendarChanges, type GoogleAccount, type GoogleCalendarClient } from './types'

// A Google Calendar that lives in memory, for local development and tests. Connecting skips
// Google's consent screen and links a sample calendar. Tests drive it through the store: change
// events, revoke a refresh token (invalid_grant), or expire every sync token (410 GONE).

export const FAKE_GOOGLE_ACCOUNT = 'sample-calendar@example.com'
const FAKE_CODE = 'fake-google-code'
const REFRESH_PREFIX = 'fake-refresh-'
const ACCESS_PREFIX = 'fake-access.'

interface FakeEntry {
  event: ExternalEvent
  removed: boolean
  /** The change number that last touched it. */
  seq: number
}

interface FakeCalendar {
  entries: Map<string, FakeEntry>
  seq: number
  /** Bumped to expire every sync token issued before. */
  epoch: number
}

export class FakeGoogleCalendarStore {
  readonly calendars = new Map<string, FakeCalendar>()
  readonly revokedTokens = new Set<string>()

  calendar(calendarId: string): FakeCalendar {
    let calendar = this.calendars.get(calendarId)
    if (!calendar) {
      calendar = { entries: new Map(), seq: 0, epoch: 0 }
      this.calendars.set(calendarId, calendar)
    }
    return calendar
  }

  put(calendarId: string, event: ExternalEvent): void {
    const calendar = this.calendar(calendarId)
    calendar.seq += 1
    calendar.entries.set(event.externalId, { event, removed: false, seq: calendar.seq })
  }

  remove(calendarId: string, externalId: string): void {
    const calendar = this.calendar(calendarId)
    const entry = calendar.entries.get(externalId)
    if (!entry) return
    calendar.seq += 1
    calendar.entries.set(externalId, { ...entry, removed: true, seq: calendar.seq })
  }

  /** Every sync token issued so far now answers 410 GONE. */
  expireSyncTokens(calendarId: string): void {
    this.calendar(calendarId).epoch += 1
  }

  /** The next refresh with this token fails with invalid_grant. */
  revoke(refreshToken: string): void {
    this.revokedTokens.add(refreshToken)
  }
}

// Kept on globalThis so the connect route, "Sync now" and the cron route share one calendar
// across hot reloads.
const globalForCalendar = globalThis as typeof globalThis & {
  gharFakeGoogleCalendar?: FakeGoogleCalendarStore
}

export function fakeGoogleCalendarStore(): FakeGoogleCalendarStore {
  globalForCalendar.gharFakeGoogleCalendar ??= new FakeGoogleCalendarStore()
  return globalForCalendar.gharFakeGoogleCalendar
}

function settle<T>(work: () => T): Promise<T> {
  try {
    return Promise.resolve(work())
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)))
  }
}

function syncToken(calendar: FakeCalendar): string {
  return `${String(calendar.epoch)}:${String(calendar.seq)}`
}

function toChange(entry: FakeEntry): ExternalEventChange {
  return entry.removed ? { kind: 'removed', externalId: entry.event.externalId } : { kind: 'upsert', ...entry.event }
}

/** A few weeks of plausible plans around today, so a fresh connection has something to show. */
function seedSampleEvents(store: FakeGoogleCalendarStore, calendarId: string, now: Date): void {
  const today = now.toISOString().slice(0, 10)
  const at = (days: number, time: string) => new Date(`${addCalendarDays(today, days)}T${time}:00Z`)
  const timed = (externalId: string, title: string, days: number, [start, end]: [string, string], location: string | null) => {
    store.put(calendarId, {
      externalId,
      title,
      description: null,
      location,
      startsAt: at(days, start),
      endsAt: at(days, end),
      allDay: false,
    })
  }
  const allDay = (externalId: string, title: string, fromDays: number, toDays: number) => {
    store.put(calendarId, {
      externalId,
      title,
      description: null,
      location: null,
      startsAt: allDayInstant(addCalendarDays(today, fromDays)),
      endsAt: allDayInstant(addCalendarDays(today, toDays + 1)),
      allDay: true,
    })
  }

  timed('sample-dentist', 'Dentist', 2, ['16:00', '17:00'], 'Maple Street Dental')
  for (const week of [0, 1, 2, 3]) {
    timed(`sample-practice_${String(week)}`, 'Soccer practice', 1 + week * 7, ['22:00', '23:30'], 'Riverside Park')
  }
  timed('sample-conference-call', 'Parent-teacher conference', 9, ['20:00', '20:30'], null)
  allDay('sample-birthday', 'Grandma’s birthday', -4, -4)
  allDay('sample-offsite', 'Work offsite', 12, 14)
}

export function createFakeGoogleCalendarClient(
  options: { store?: FakeGoogleCalendarStore; now?: () => Date; seed?: boolean } = {}
): GoogleCalendarClient {
  const store = options.store ?? fakeGoogleCalendarStore()
  const now = options.now ?? (() => new Date())
  const seed = options.seed ?? true

  function assertGrant(refreshToken: string): void {
    if (!refreshToken.startsWith(REFRESH_PREFIX) || store.revokedTokens.has(refreshToken)) {
      throw new CalendarAuthError('Google stopped accepting this connection.')
    }
  }

  return {
    authorizationUrl({ state, redirectUri }) {
      // No consent screen: straight back to the callback, as if the person had allowed access.
      const url = new URL(redirectUri)
      url.searchParams.set('code', FAKE_CODE)
      url.searchParams.set('state', state)
      return url.toString()
    },

    exchangeCode({ code }) {
      return settle((): GoogleAccount => {
        if (code !== FAKE_CODE) {
          throw new CalendarAuthError('Google didn’t accept the sign-in. Try connecting again.')
        }
        if (seed && store.calendar(FAKE_GOOGLE_ACCOUNT).entries.size === 0) {
          seedSampleEvents(store, FAKE_GOOGLE_ACCOUNT, now())
        }
        return {
          refreshToken: `${REFRESH_PREFIX}${randomUUID()}`,
          accountEmail: FAKE_GOOGLE_ACCOUNT,
          calendarId: FAKE_GOOGLE_ACCOUNT,
        }
      })
    },

    accessToken(refreshToken) {
      return settle(() => {
        assertGrant(refreshToken)
        return `${ACCESS_PREFIX}${refreshToken}`
      })
    },

    listChanges(input) {
      return settle((): CalendarChanges => {
        assertGrant(input.accessToken.slice(ACCESS_PREFIX.length))
        const calendar = store.calendar(input.calendarId)
        const entries = [...calendar.entries.values()].sort((a, b) => a.seq - b.seq)

        if (input.syncToken !== undefined) {
          const [epoch, seq] = input.syncToken.split(':').map(Number)
          if (epoch !== calendar.epoch || seq === undefined || !(seq <= calendar.seq)) {
            throw new SyncTokenExpiredError('Google expired the sync token.')
          }
          return {
            changes: entries.filter(entry => entry.seq > seq).map(toChange),
            nextSyncToken: syncToken(calendar),
          }
        }
        const timeMin = input.timeMin.getTime()
        return {
          changes: entries.filter(entry => !entry.removed && entry.event.endsAt.getTime() >= timeMin).map(toChange),
          nextSyncToken: syncToken(calendar),
        }
      })
    },

    revoke(refreshToken) {
      store.revoke(refreshToken)
      return Promise.resolve()
    },
  }
}
