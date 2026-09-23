import 'server-only'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export type Database = ReturnType<typeof createDb>

/**
 * Creates the Drizzle client. Call once per server process.
 * `prepare: false` is required by Supabase's transaction pooler.
 *
 * A page runs its queries in parallel, so the pool needs room for a few at once; a pool of one
 * would turn every Promise.all into a waterfall. Idle connections close after 20 seconds so a
 * suspended serverless instance doesn't hold pooler slots, and a dead pooler fails in 10 seconds
 * instead of 30.
 */
export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 10 })
  return drizzle({ client, schema, casing: 'snake_case' })
}

export { schema }
