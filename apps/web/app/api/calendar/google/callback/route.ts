import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from '@ghar/core/errors'
import { NextResponse, type NextRequest } from 'next/server'
import { getRequestContext, type RequestContext } from '@/lib/auth/context'
import type { ConnectStatus } from '@/lib/calendar/display'
import { OAUTH_COOKIE, oauthCookieOptions, verifyOAuthState } from '@/lib/calendar/oauth'
import * as calendar from '@/lib/calendar/service'
import { appReturnUrl, isSignedOAuthState, signedCallbackStep, type OAuthReturnTo } from '@/lib/oauth-state'
import { CalendarAuthError } from '@/lib/providers/google-calendar'

// Where Google sends someone after the consent screen, always clearing the state cookie.
//
// Started from the web app, the state is a random value in a sealed cookie, and it ends on /calendar
// with a status the page explains. Started through /api/v1/calendar/links/authorize, the state is
// signed and the code is only ever used for the person who asked (lib/oauth-state.ts): `web` needs
// them signed in here, and `app` hands the code, sealed, to the phone to finish with its own token.

export const dynamic = 'force-dynamic'

function finish(request: NextRequest, path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, request.url))
  response.headers.set('cache-control', 'private, no-store')
  response.cookies.set(OAUTH_COOKIE, '', { ...oauthCookieOptions(), maxAge: 0 })
  return response
}

function toCalendar(request: NextRequest, status: ConnectStatus, returnTo: OAuthReturnTo = 'web'): NextResponse {
  return finish(request, returnTo === 'app' ? appReturnUrl('calendar', status) : `/calendar?calendar=${status}`)
}

export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams
  const state = params.get('state')
  if (isSignedOAuthState(state)) return finishSigned(request, state)

  let ctx
  try {
    ctx = await getRequestContext()
  } catch (error) {
    if (error instanceof UnauthorizedError) return finish(request, '/login')
    if (error instanceof NotFoundError) return finish(request, '/onboarding')
    throw error
  }

  if (params.get('error') !== null) return toCalendar(request, 'cancelled')

  const verified = verifyOAuthState({
    cookie: request.cookies.get(OAUTH_COOKIE)?.value,
    state,
    ctx,
  })
  if (!verified) return toCalendar(request, 'expired')

  return connect(request, ctx, params.get('code'))
}

async function finishSigned(request: NextRequest, state: string): Promise<Response> {
  const params = request.nextUrl.searchParams
  const next = await signedCallbackStep({
    purpose: 'calendar',
    permission: 'calendar.manage',
    state,
    code: params.get('code'),
    error: params.get('error'),
    session: getRequestContext,
  })
  if (next.step === 'stop') return toCalendar(request, next.status, next.returnTo)
  if (next.step === 'handoff') return finish(request, next.url)
  return connect(request, next.ctx, next.code)
}

async function connect(request: NextRequest, ctx: RequestContext, code: string | null): Promise<Response> {
  if (!code) return toCalendar(request, 'failed')

  try {
    const { sync } = await calendar.connectGoogleCalendar(ctx, { code })
    return toCalendar(request, sync.outcome === 'synced' ? 'connected' : 'connected_sync_failed')
  } catch (error) {
    if (error instanceof CalendarAuthError) return toCalendar(request, 'denied')
    if (error instanceof ConflictError) return toCalendar(request, 'taken')
    if (error instanceof ForbiddenError) return toCalendar(request, 'forbidden')
    // Name and message only: nothing from Google's token response.
    console.error(`Linking a Google Calendar failed: ${error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'}`)
    return toCalendar(request, 'failed')
  }
}
