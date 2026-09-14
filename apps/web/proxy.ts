import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isPublicPath } from '@/lib/auth/paths';
import { env } from '@/lib/env';

/**
 * Refreshes the Supabase session cookie on page requests and sends signed-out visitors to
 * /login. A convenience, not the boundary: layouts, server actions and route handlers each
 * check the session again through lib/auth/context.ts.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = env();

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Verifies the JWT and, when it is close to expiring, refreshes it through setAll above.
  const { data } = await supabase.auth.getClaims();
  const { pathname, search } = request.nextUrl;
  if (data?.claims || isPublicPath(pathname)) return response;

  const login = new URL('/login', request.url);
  if (pathname !== '/') login.searchParams.set('next', `${pathname}${search}`);
  const redirect = NextResponse.redirect(login);
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export const config = {
  // API routes authenticate themselves, with cookies or a bearer token, and answer 401 as JSON.
  // /styleguide needs no session: it shows sample data, and it 404s outside development.
  matcher: [
    '/((?!api/|styleguide(?:/|$)|_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
