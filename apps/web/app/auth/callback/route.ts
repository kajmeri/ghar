import { safeRedirectPath } from '@ghar/core/redirects'
import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Where magic links land. `token_hash` comes from Ghar's email template and works in any
 * browser; `code` comes from Supabase's default template and only in the browser that asked.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const next = safeRedirectPath(searchParams.get('next'))
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')

  let signedIn = false
  if (code || tokenHash) {
    const supabase = await createSupabaseServerClient()
    const { error } = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.verifyOtp({ token_hash: tokenHash ?? '', type: 'email' })
    signedIn = !error
  }

  const destination = signedIn ? new URL(next, request.url) : new URL('/login', request.url)
  if (!signedIn) {
    destination.searchParams.set('error', 'link')
    if (next !== '/') destination.searchParams.set('next', next)
  }
  const response = NextResponse.redirect(destination)
  response.headers.set('cache-control', 'private, no-store')
  return response
}
