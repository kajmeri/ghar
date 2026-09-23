import 'server-only'
import { z } from 'zod'

// Blank lines in an .env file arrive as empty strings. Treat them as unset so defaults apply.
function unset(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value
}

/** A Sentry DSN, like `https://public-key@o0.ingest.sentry.io/0`. Self-hosted ones may have a path. */
const sentryDsn = z.string().regex(/^https:\/\/[^\s@/:]+@[^\s/@]+(?:\/[^\s@]*)?\/\d+$/)

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
  /** Origin used in emailed links and the Google callback. No trailing slash. Vercel fills it in when unset. */
  APP_URL: z.preprocess(unset, z.url().default('http://localhost:3000')).transform(url => url.replace(/\/+$/, '')),
  /** Without it, emails print to the server console. Required in production. */
  RESEND_API_KEY: z.preprocess(unset, z.string().min(1).optional()),
  /** Vercel Cron sends it as a bearer token. Cron routes refuse every request while it's unset. */
  CRON_SECRET: z.preprocess(unset, z.string().min(16).optional()),
  /**
   * Travelpayouts Data API token for the daily price watch. Without it, local development quotes
   * what was paid until someone sets a price on the booking page, and production refuses to run.
   */
  TRAVELPAYOUTS_TOKEN: z.preprocess(unset, z.string().min(1).optional()),
  /**
   * Base64 of 32 random bytes. Seals Google refresh tokens and Plaid access tokens at rest (see lib/crypto.ts). Linking a
   * calendar fails with a clear error while it's unset. Changing it strands every stored token
   * unless the old key moves to ENCRYPTION_KEY_PREVIOUS (see docs/runbook.md).
   */
  ENCRYPTION_KEY: z.preprocess(unset, z.string().min(1).optional()),
  /**
   * Only during a key rotation: the key being retired. Stored secrets it sealed still open until
   * `pnpm --filter web secrets:reseal --write` seals them again under ENCRYPTION_KEY. Unset it after.
   */
  ENCRYPTION_KEY_PREVIOUS: z.preprocess(unset, z.string().min(1).optional()),
  /**
   * Google OAuth client for calendar linking. Without both, local development links a made-up
   * calendar with sample events, and production refuses to.
   */
  GOOGLE_CLIENT_ID: z.preprocess(unset, z.string().min(1).optional()),
  GOOGLE_CLIENT_SECRET: z.preprocess(unset, z.string().min(1).optional()),
  /**
   * Reads booking confirmations out of linked Gmail inboxes with Claude Haiku. Without it, local
   * development uses a canned extraction, and production refuses to read mail.
   */
  ANTHROPIC_API_KEY: z.preprocess(unset, z.string().min(1).optional()),
  /**
   * Plaid keys for bank connections. A client ID has a separate secret per Plaid environment, and
   * PLAID_ENV names the one PLAID_SECRET belongs to; connections made in the other are left alone.
   * Without both keys, local development syncs only made-up connections, and production refuses to
   * sync real ones.
   */
  PLAID_CLIENT_ID: z.preprocess(unset, z.string().min(1).optional()),
  PLAID_SECRET: z.preprocess(unset, z.string().min(1).optional()),
  PLAID_ENV: z.preprocess(unset, z.enum(['sandbox', 'production']).default('sandbox')),
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
  /**
   * Server errors and the daily cron's check-ins go to this Sentry project. Without it they go only to
   * the server log, redacted (see lib/providers/monitoring).
   */
  SENTRY_DSN: z.preprocess(unset, sentryDsn.optional()),
  /**
   * The DSN the browser reports to, from an error page, for errors that happen only in the browser.
   * Inlined into the client bundle at build time, so it takes a redeploy to change. Usually the same
   * value as SENTRY_DSN, which is fine: a DSN only lets someone send events.
   */
  NEXT_PUBLIC_SENTRY_DSN: z.preprocess(unset, sentryDsn.optional()),
  /** Sentry's environment name. Defaults to VERCEL_ENV, then NODE_ENV. */
  SENTRY_ENVIRONMENT: z.preprocess(unset, z.string().regex(/^[\w.-]{1,64}$/).optional()),
  /** Where a failed cron job is emailed. Needs RESEND_API_KEY too; without either, no alert is sent. */
  ALERT_EMAIL: z.preprocess(unset, z.email().optional()),
})

export type Env = z.output<typeof envSchema>

const monitoringSchema = envSchema.pick({ SENTRY_DSN: true, SENTRY_ENVIRONMENT: true, ALERT_EMAIL: true, RESEND_API_KEY: true })
export type MonitoringEnv = z.output<typeof monitoringSchema>

/**
 * Only the variables monitoring and alerts read, checked one by one. Unlike env() it never throws: a
 * broken DATABASE_URL is exactly what monitoring has to report. A variable that is set but invalid is
 * ignored, and the warning names it without echoing its value.
 */
export function monitoringEnv(vars: Record<string, string | undefined> = process.env): MonitoringEnv {
  const invalid: string[] = []
  const { shape } = monitoringSchema
  function read<T>(name: keyof MonitoringEnv, schema: z.ZodType<T>): T | undefined {
    const result = schema.safeParse(vars[name])
    if (result.success) return result.data
    invalid.push(name)
    return undefined
  }
  const result: MonitoringEnv = {
    SENTRY_DSN: read('SENTRY_DSN', shape.SENTRY_DSN),
    SENTRY_ENVIRONMENT: read('SENTRY_ENVIRONMENT', shape.SENTRY_ENVIRONMENT),
    ALERT_EMAIL: read('ALERT_EMAIL', shape.ALERT_EMAIL),
    RESEND_API_KEY: read('RESEND_API_KEY', shape.RESEND_API_KEY),
  }
  if (invalid.length > 0) {
    console.warn(`Ignoring invalid monitoring variables: ${invalid.join(', ')}. See apps/web/.env.example.`)
  }
  return result
}

/**
 * The deployment's own origin, from the variables Vercel sets on every deployment. Production uses
 * the project's production domain, a custom one once it's assigned. A preview uses its branch URL,
 * so its links come back to the preview. Elsewhere there is none.
 */
export function vercelOrigin(vars: Record<string, string | undefined>): string | undefined {
  const host = vars.VERCEL_ENV === 'production' ? vars.VERCEL_PROJECT_PRODUCTION_URL : (vars.VERCEL_BRANCH_URL ?? vars.VERCEL_URL)
  return host ? `https://${host}` : undefined
}

let cached: Env | undefined

/**
 * Validated server environment. Read lazily, so `next build` works without secrets. The error
 * names the variables that are wrong and never echoes their values.
 */
export function env(): Env {
  if (cached) return cached
  const result = envSchema.safeParse({ ...process.env, APP_URL: unset(process.env.APP_URL) ?? vercelOrigin(process.env) })
  if (!result.success) {
    const names = Array.from(new Set(result.error.issues.map(issue => String(issue.path[0]))))
    throw new Error(`Missing or invalid environment variables: ${names.join(', ')}. See apps/web/.env.example.`)
  }
  cached = result.data
  return cached
}
