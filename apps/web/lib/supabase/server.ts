import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { env } from '@/lib/env'

/**
 * A Supabase client bound to this request's cookies, for Server Components, server actions and
 * route handlers. Create one per request; never share it.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = env()
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server Components can't write cookies. proxy.ts refreshes the session instead.
        }
      },
    },
  })
}
