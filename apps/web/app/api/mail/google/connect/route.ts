import { can } from '@ghar/core/auth'
import { NotFoundError, UnauthorizedError } from '@ghar/core/errors'
import { NextResponse, type NextRequest } from 'next/server'
import { getRequestContext } from '@/lib/auth/context'
import { REVIEW_PATH } from '@/lib/mail/display'
import { createMailOAuthState, MAIL_OAUTH_COOKIE, mailOAuthCookieOptions, mailRedirectUri } from '@/lib/mail/oauth'
import { getGmailClient } from '@/lib/providers/gmail'

// Starts linking the signed-in person's own Gmail, read-only. A browser opens this (the review
// page's Link Gmail button, or the phone app in a browser tab); Google sends them back to ./callback.

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
  if (!can(ctx.role, 'travel.manage')) {
    return redirectTo(request, `${REVIEW_PATH}?gmail=forbidden`)
  }

  let location: string
  let cookie: string
  try {
    const client = getGmailClient()
    const oauth = createMailOAuthState(ctx)
    cookie = oauth.cookie
    location = client.authorizationUrl({ state: oauth.state, redirectUri: mailRedirectUri() })
  } catch (error) {
    // Missing Google credentials or ENCRYPTION_KEY. The messages name variables, never values.
    console.error(`Gmail linking is unavailable: ${error instanceof Error ? error.message : 'unknown error'}`)
    return redirectTo(request, `${REVIEW_PATH}?gmail=unavailable`)
  }

  const response = redirectTo(request, location)
  response.cookies.set(MAIL_OAUTH_COOKIE, cookie, mailOAuthCookieOptions())
  return response
}
