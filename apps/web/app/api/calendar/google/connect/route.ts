import { can } from '@ghar/core/auth'
import { NotFoundError, UnauthorizedError } from '@ghar/core/errors'
import { NextResponse, type NextRequest } from 'next/server'
import { getRequestContext } from '@/lib/auth/context'
import { createOAuthState, googleRedirectUri, OAUTH_COOKIE, oauthCookieOptions } from '@/lib/calendar/oauth'
import { getGoogleCalendarClient } from '@/lib/providers/google-calendar'

// Starts linking the signed-in person's own Google Calendar. A browser opens this (the web app's
// Connect button, or the phone app in a browser tab); Google sends them back to ./callback.

export const dynamic = 'force-dynamic'

function redirectTo(request: NextRequest, path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, request.url))
  response.headers.set('cache-control', 'private, no-store')
  return response
}

export async function GET(request: NextRequest): Promise<Response> {
  let ctx
  try {
    ctx = await getRequestContext()
  } catch (error) {
    if (error instanceof UnauthorizedError) return redirectTo(request, '/login')
    if (error instanceof NotFoundError) return redirectTo(request, '/onboarding')
    throw error
  }
  if (!can(ctx.role, 'calendar.manage')) {
    return redirectTo(request, '/calendar?calendar=forbidden')
  }

  let location: string
  let cookie: string
  try {
    const client = getGoogleCalendarClient()
    const oauth = createOAuthState(ctx)
    cookie = oauth.cookie
    location = client.authorizationUrl({ state: oauth.state, redirectUri: googleRedirectUri() })
  } catch (error) {
    // Missing Google credentials or ENCRYPTION_KEY. The messages name variables, never values.
    console.error(`Calendar connection is unavailable: ${error instanceof Error ? error.message : 'unknown error'}`)
    return redirectTo(request, '/calendar?calendar=unavailable')
  }

  const response = redirectTo(request, location)
  response.cookies.set(OAUTH_COOKIE, cookie, oauthCookieOptions())
  return response
}
