import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from '@ghar/core/errors';
import { NextResponse, type NextRequest } from 'next/server';
import { getRequestContext } from '@/lib/auth/context';
import { OAUTH_COOKIE, oauthCookieOptions, verifyOAuthState } from '@/lib/calendar/oauth';
import * as calendar from '@/lib/calendar/service';
import { CalendarAuthError } from '@/lib/providers/google-calendar';
import type { ConnectStatus } from '@/lib/calendar/display';

// Where Google sends someone after the consent screen. Always ends on /calendar, with a status the
// page explains, and always clears the state cookie.

export const dynamic = 'force-dynamic';

function finish(request: NextRequest, path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, request.url));
  response.headers.set('cache-control', 'private, no-store');
  response.cookies.set(OAUTH_COOKIE, '', { ...oauthCookieOptions(), maxAge: 0 });
  return response;
}

function toCalendar(request: NextRequest, status: ConnectStatus): NextResponse {
  return finish(request, `/calendar?calendar=${status}`);
}

export async function GET(request: NextRequest): Promise<Response> {
  let ctx;
  try {
    ctx = await getRequestContext();
  } catch (error) {
    if (error instanceof UnauthorizedError) return finish(request, '/login');
    if (error instanceof NotFoundError) return finish(request, '/onboarding');
    throw error;
  }

  const params = request.nextUrl.searchParams;
  if (params.get('error') !== null) return toCalendar(request, 'cancelled');

  const verified = verifyOAuthState({
    cookie: request.cookies.get(OAUTH_COOKIE)?.value,
    state: params.get('state'),
    ctx,
  });
  if (!verified) return toCalendar(request, 'expired');

  const code = params.get('code');
  if (!code) return toCalendar(request, 'failed');

  try {
    const { sync } = await calendar.connectGoogleCalendar(ctx, { code });
    return toCalendar(request, sync.outcome === 'synced' ? 'connected' : 'connected_sync_failed');
  } catch (error) {
    if (error instanceof CalendarAuthError) return toCalendar(request, 'denied');
    if (error instanceof ConflictError) return toCalendar(request, 'taken');
    if (error instanceof ForbiddenError) return toCalendar(request, 'forbidden');
    // Name and message only: nothing from Google's token response.
    console.error(
      `Linking a Google Calendar failed: ${error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'}`,
    );
    return toCalendar(request, 'failed');
  }
}
