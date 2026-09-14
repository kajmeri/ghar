import 'server-only'
import { normalizeEmail } from '@ghar/core/invitations'
import { z } from 'zod'

// Blank lines in an .env file arrive as empty strings. Treat them as unset so defaults apply.
function unset(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value
}

const envSchema = z.object({
  /** Supabase transaction pooler, port 6543. */
  DATABASE_URL: z.preprocess(unset, z.string().regex(/^postgres(ql)?:\/\//)),
  SUPABASE_URL: z.preprocess(unset, z.url()),
  /** The publishable key, or the legacy anon key. Safe to expose, but only the server uses it. */
  SUPABASE_PUBLISHABLE_KEY: z.preprocess(unset, z.string().min(1)),
  /**
   * Server only, never logged. The seed script uses it, and with STORAGE_PROVIDER=supabase the
   * server signs document upload and file links with it. Nothing else may use it in request code
   * that runs in production.
   */
  SUPABASE_SECRET_KEY: z.preprocess(unset, z.string().min(1).optional()),
  /** Origin used in emailed links. No trailing slash. */
  APP_URL: z.preprocess(unset, z.url().default('http://localhost:3000')).transform(url => url.replace(/\/+$/, '')),
  /** Without it, emails print to the server console. Required in production. */
  RESEND_API_KEY: z.preprocess(unset, z.string().min(1).optional()),
  EMAIL_FROM: z.preprocess(unset, z.string().min(1).default('Ghar <onboarding@resend.dev>')),
  /**
   * Comma-separated addresses that may create an account without an invitation. Ghar has no
   * public signup: everyone else needs a pending invitation. Existing accounts always sign in.
   */
  SIGNUP_EMAILS: z.preprocess(unset, z.string().default('')).transform(
    value =>
      new Set(
        value
          .split(',')
          .map(email => normalizeEmail(email))
          .filter(Boolean)
      )
  ),
  /** Vercel Cron sends it as a bearer token. Cron routes refuse every request while it's unset. */
  CRON_SECRET: z.preprocess(unset, z.string().min(16).optional()),
  /**
   * Where the daily price watch gets prices. `fake` quotes what was paid until someone sets a
   * price on the booking page, and production refuses it.
   */
  PRICE_PROVIDER: z.preprocess(unset, z.enum(['fake', 'travelpayouts']).default('fake')),
  /** Travelpayouts Data API token, for PRICE_PROVIDER=travelpayouts. */
  TRAVELPAYOUTS_TOKEN: z.preprocess(unset, z.string().min(1).optional()),
  /**
   * Base64 of 32 random bytes. Seals Google refresh tokens at rest (see lib/crypto.ts). Linking a
   * calendar fails with a clear error while it's unset. Changing it strands every stored token.
   */
  ENCRYPTION_KEY: z.preprocess(unset, z.string().min(1).optional()),
  /**
   * `fake` links a made-up calendar with sample events and needs no Google project; production
   * refuses it. `google` needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
   */
  CALENDAR_PROVIDER: z.preprocess(unset, z.enum(['fake', 'google']).default('fake')),
  GOOGLE_CLIENT_ID: z.preprocess(unset, z.string().min(1).optional()),
  GOOGLE_CLIENT_SECRET: z.preprocess(unset, z.string().min(1).optional()),
  /**
   * Travel times between itinerary stops. `estimate` works them out from distance and needs
   * nothing. `osrm` asks the OSRM server at OSRM_URL for walking and driving routes, and keeps
   * the estimate for any leg it cannot answer.
   */
  ROUTING_PROVIDER: z.preprocess(unset, z.enum(['estimate', 'osrm']).default('estimate')),
  /** An OSRM server's origin, for ROUTING_PROVIDER=osrm. It receives the trip's coordinates. */
  OSRM_URL: z.preprocess(unset, z.url({ protocol: /^https?$/ }).optional()).transform(url => url?.replace(/\/+$/, '')),
  /**
   * Where document files live. `fake` keeps them in the dev server's memory until it restarts;
   * production refuses it. `supabase` uses the private `documents` bucket and needs
   * SUPABASE_SECRET_KEY.
   */
  STORAGE_PROVIDER: z.preprocess(unset, z.enum(['fake', 'supabase']).default('fake')),
})

export type Env = z.output<typeof envSchema>

let cached: Env | undefined

/**
 * Validated server environment. Read lazily, so `next build` works without secrets. The error
 * names the variables that are wrong and never echoes their values.
 */
export function env(): Env {
  if (cached) return cached
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    const names = Array.from(new Set(result.error.issues.map(issue => String(issue.path[0]))))
    throw new Error(`Missing or invalid environment variables: ${names.join(', ')}. See apps/web/.env.example.`)
  }
  cached = result.data
  return cached
}
