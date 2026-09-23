import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from '@ghar/core/errors'
import { NextResponse, type NextRequest } from 'next/server'
import { getRequestContext, type RequestContext } from '@/lib/auth/context'
import { REVIEW_PATH, type MailConnectStatus } from '@/lib/mail/display'
import { MAIL_OAUTH_COOKIE, mailOAuthCookieOptions, verifyMailOAuthState } from '@/lib/mail/oauth'
import * as mail from '@/lib/mail/service'
import { appReturnUrl, isSignedOAuthState, signedCallbackStep, type OAuthReturnTo } from '@/lib/oauth-state'
import { MailAuthError } from '@/lib/providers/gmail'

// Where Google sends someone after the consent screen, always clearing the state cookie. Linking
// reads no mail: that waits for the morning check or Check now.
//
// Started from the web app, the state is a random value in a sealed cookie, and it ends on the review
// page with a status the page explains. Started through /api/v1/mail/link/authorize, the state is
// signed and the code is only ever used for the person who asked (lib/oauth-state.ts): `web` needs
// them signed in here, and `app` hands the code, sealed, to the phone to finish with its own token.

export const dynamic = 'force-dynamic'

function finish(request: NextRequest, path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, request.url))
  response.headers.set('cache-control', 'private, no-store')
  response.cookies.set(MAIL_OAUTH_COOKIE, '', { ...mailOAuthCookieOptions(), maxAge: 0 })
  return response
}

function toReview(request: NextRequest, status: MailConnectStatus, returnTo: OAuthReturnTo = 'web'): NextResponse {
  return finish(request, returnTo === 'app' ? appReturnUrl('mail', status) : `${REVIEW_PATH}?gmail=${status}`)
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

  if (params.get('error') !== null) return toReview(request, 'cancelled')

  const verified = verifyMailOAuthState({
    cookie: request.cookies.get(MAIL_OAUTH_COOKIE)?.value,
    state,
    ctx,
  })
  if (!verified) return toReview(request, 'expired')

  return connect(request, ctx, params.get('code'))
}

async function finishSigned(request: NextRequest, state: string): Promise<Response> {
  const params = request.nextUrl.searchParams
  const next = await signedCallbackStep({
    purpose: 'mail',
    permission: 'travel.manage',
    state,
    code: params.get('code'),
    error: params.get('error'),
    session: getRequestContext,
  })
  if (next.step === 'stop') return toReview(request, next.status, next.returnTo)
  if (next.step === 'handoff') return finish(request, next.url)
  return connect(request, next.ctx, next.code)
}

async function connect(request: NextRequest, ctx: RequestContext, code: string | null): Promise<Response> {
  if (!code) return toReview(request, 'failed')

  try {
    await mail.connectGmail(ctx, { code })
    return toReview(request, 'connected')
  } catch (error) {
    if (error instanceof MailAuthError) return toReview(request, 'denied')
    if (error instanceof ConflictError) return toReview(request, 'taken')
    if (error instanceof ForbiddenError) return toReview(request, 'forbidden')
    // Name and message only: nothing from Google's token response.
    console.error(`Linking Gmail failed: ${error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'}`)
    return toReview(request, 'failed')
  }
}
