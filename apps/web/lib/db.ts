import 'server-only'
import { createDbFromPool, createPool, type Database, type Pool } from '@ghar/db'
import { env } from '@/lib/env'

// The pool is kept on globalThis so hot reloads in development reuse its connections. The Drizzle
// client isn't: it caches the schema's columns, so it's rebuilt whenever this module reloads.
const globalForDb = globalThis as typeof globalThis & { gharPool?: Pool }
let db: Database | undefined

/** The shared Drizzle client. apps/web is the only workspace allowed to import @ghar/db. */
export function getDb(): Database {
  db ??= createDbFromPool((globalForDb.gharPool ??= createPool(env().DATABASE_URL)))
  return db
}
