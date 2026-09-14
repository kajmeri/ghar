import 'server-only'
import { allDayInstant, type ExternalEventChange } from '@ghar/core/calendar'
import { addCalendarDays, isCalendarDate } from '@ghar/core/dates'
import { z } from 'zod'
import {
  CalendarAuthError,
  CalendarProviderError,
  SyncTokenExpiredError,
  type CalendarChanges,
  type GoogleAccount,
  type GoogleCalendarClient,
  type ListChangesInput,
} from './types'

// Google Calendar over plain fetch: OAuth 2.0 for web server apps, and events.list with sync
// tokens. Tokens travel only in headers and form bodies, never in URLs or errors.

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

export const CALENDAR_READ_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'
const SCOPES = ['openid', 'email', CALENDAR_READ_SCOPE]

/** Pages of 2,500 events. A calendar needing more than this many pages is refused, not looped on. */
const PAGE_SIZE = 2500
const MAX_PAGES = 40

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().default(''),
})

const tokenErrorSchema = z.object({ error: z.string() })

const userInfoSchema = z.object({ email: z.email() })

const calendarSchema = z.object({ id: z.string().min(1) })

const eventTimeSchema = z.object({
  date: z.string().optional(),
  dateTime: z.string().optional(),
})

const googleEventSchema = z.object({
  id: z.string().min(1),
  status: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  eventType: z.string().optional(),
  start: eventTimeSchema.optional(),
  end: eventTimeSchema.optional(),
  attendees: z.array(z.object({ self: z.boolean().optional(), responseStatus: z.string().optional() })).optional(),
})

const eventsPageSchema = z.object({
  items: z.array(googleEventSchema).default([]),
  nextPageToken: z.string().optional(),
  nextSyncToken: z.string().optional(),
})

const apiErrorSchema = z.object({
  error: z.object({
    errors: z.array(z.object({ reason: z.string().optional() })).optional(),
  }),
})

type GoogleEvent = z.infer<typeof googleEventSchema>

/** Events that aren't really plans: Google's "working from home" markers. */
const IGNORED_EVENT_TYPES = new Set(['workingLocation'])

/** Google's shape to ours. Cancelled, declined and ignored events become removals. */
export function toExternalChange(event: GoogleEvent): ExternalEventChange | null {
  const declined = event.attendees?.some(attendee => attendee.self === true && attendee.responseStatus === 'declined')
  if (event.status === 'cancelled' || declined === true || IGNORED_EVENT_TYPES.has(event.eventType ?? '')) {
    return { kind: 'removed', externalId: event.id }
  }

  const base = {
    kind: 'upsert' as const,
    externalId: event.id,
    title: event.summary ?? '',
    description: event.description ?? null,
    location: event.location ?? null,
  }
  const startDate = event.start?.date
  if (startDate !== undefined && isCalendarDate(startDate)) {
    const endDate = event.end?.date
    return {
      ...base,
      allDay: true,
      startsAt: allDayInstant(startDate),
      // Google's end date is exclusive, like ours.
      endsAt: allDayInstant(endDate !== undefined && isCalendarDate(endDate) ? endDate : addCalendarDays(startDate, 1)),
    }
  }
  const startsAt = parseInstant(event.start?.dateTime)
  if (!startsAt) return null
  return { ...base, allDay: false, startsAt, endsAt: parseInstant(event.end?.dateTime) ?? startsAt }
}

function parseInstant(value: string | undefined): Date | null {
  if (value === undefined) return null
  const instant = new Date(value)
  return Number.isNaN(instant.getTime()) ? null : instant
}

export interface GoogleCalendarOptions {
  clientId: string
  clientSecret: string
  fetch?: typeof fetch
  timeoutMs?: number
}

export function createGoogleCalendarClient(options: GoogleCalendarOptions): GoogleCalendarClient {
  const fetchImpl = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? 15_000

  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    } catch {
      throw new CalendarProviderError('Google Calendar didn’t respond. The next sync will retry.')
    }
  }

  async function readJson(response: Response): Promise<unknown> {
    try {
      return (await response.json()) as unknown
    } catch {
      return null
    }
  }

  async function postForm(url: string, form: Record<string, string>): Promise<Response> {
    return send(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form),
    })
  }

  async function getJson<S extends z.ZodType>(url: string, accessToken: string, schema: S): Promise<z.output<S>> {
    const response = await send(url, { headers: { authorization: `Bearer ${accessToken}` } })
    if (!response.ok) throw await apiError(response)
    const parsed = schema.safeParse(await readJson(response))
    if (!parsed.success) {
      throw new CalendarProviderError('Google Calendar sent a response Ghar couldn’t read.')
    }
    return parsed.data
  }

  async function apiError(response: Response): Promise<Error> {
    if (response.status === 410) {
      return new SyncTokenExpiredError('Google expired the sync token.')
    }
    if (response.status === 401) {
      return new CalendarAuthError('Google stopped accepting this connection.')
    }
    if (response.status === 403) {
      const body = apiErrorSchema.safeParse(await readJson(response))
      const reasons = body.success ? (body.data.error.errors ?? []).map(e => e.reason) : []
      if (reasons.includes('insufficientPermissions') || reasons.includes('forbidden')) {
        return new CalendarAuthError('Ghar no longer has permission to read this calendar.')
      }
      return new CalendarProviderError('Google Calendar is limiting requests. The next sync will retry.')
    }
    return new CalendarProviderError(`Google Calendar answered ${String(response.status)}. The next sync will retry.`)
  }

  return {
    authorizationUrl({ state, redirectUri }) {
      const url = new URL(AUTH_URL)
      url.search = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        // offline + consent: Google returns a refresh token every time, including on reconnect.
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
      }).toString()
      return url.toString()
    },

    async exchangeCode({ code, redirectUri }): Promise<GoogleAccount> {
      const response = await postForm(TOKEN_URL, {
        code,
        client_id: options.clientId,
        client_secret: options.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      })
      if (!response.ok) {
        if (response.status >= 500) {
          throw new CalendarProviderError('Google didn’t finish connecting. Try again.')
        }
        throw new CalendarAuthError('Google didn’t accept the sign-in. Try connecting again.')
      }
      const tokens = tokenResponseSchema.safeParse(await readJson(response))
      if (!tokens.success) {
        throw new CalendarProviderError('Google sent a sign-in response Ghar couldn’t read.')
      }
      if (!tokens.data.scope.split(' ').includes(CALENDAR_READ_SCOPE)) {
        throw new CalendarAuthError('Calendar access wasn’t granted. Connect again and allow it.')
      }
      if (!tokens.data.refresh_token) {
        throw new CalendarAuthError('Google didn’t grant offline access. Try connecting again.')
      }
      const accessToken = tokens.data.access_token
      const [user, calendar] = await Promise.all([
        getJson(USERINFO_URL, accessToken, userInfoSchema),
        getJson(`${CALENDAR_API}/calendars/primary`, accessToken, calendarSchema),
      ])
      return {
        refreshToken: tokens.data.refresh_token,
        accountEmail: user.email,
        calendarId: calendar.id,
      }
    },

    async accessToken(refreshToken) {
      const response = await postForm(TOKEN_URL, {
        refresh_token: refreshToken,
        client_id: options.clientId,
        client_secret: options.clientSecret,
        grant_type: 'refresh_token',
      })
      if (!response.ok) {
        const body = tokenErrorSchema.safeParse(await readJson(response))
        if (body.success && body.data.error === 'invalid_grant') {
          throw new CalendarAuthError('Google stopped accepting this connection.')
        }
        throw new CalendarProviderError(`Google refused to refresh access (${String(response.status)}). The next sync will retry.`)
      }
      const tokens = tokenResponseSchema.safeParse(await readJson(response))
      if (!tokens.success) {
        throw new CalendarProviderError('Google sent a token response Ghar couldn’t read.')
      }
      return tokens.data.access_token
    },

    async listChanges(input: ListChangesInput): Promise<CalendarChanges> {
      const changes: ExternalEventChange[] = []
      let pageToken: string | undefined
      for (let page = 0; page < MAX_PAGES; page++) {
        const params = new URLSearchParams({
          singleEvents: 'true',
          maxResults: String(PAGE_SIZE),
        })
        if (input.syncToken !== undefined) {
          params.set('syncToken', input.syncToken)
        } else {
          params.set('timeMin', input.timeMin.toISOString())
        }
        if (pageToken !== undefined) params.set('pageToken', pageToken)

        const body = await getJson(
          `${CALENDAR_API}/calendars/${encodeURIComponent(input.calendarId)}/events?${params.toString()}`,
          input.accessToken,
          eventsPageSchema
        )
        for (const event of body.items) {
          const change = toExternalChange(event)
          if (change) changes.push(change)
        }
        if (body.nextPageToken !== undefined) {
          pageToken = body.nextPageToken
          continue
        }
        if (body.nextSyncToken === undefined) {
          throw new CalendarProviderError('Google Calendar ended a listing without a sync token.')
        }
        return { changes, nextSyncToken: body.nextSyncToken }
      }
      throw new CalendarProviderError('This calendar has more events than Ghar can sync at once.')
    },

    async revoke(refreshToken) {
      // 400 means the token was already revoked or expired, which is what we wanted.
      await postForm(REVOKE_URL, { token: refreshToken }).catch(() => undefined)
    },
  }
}
