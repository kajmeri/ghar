import 'server-only'
import { createDb, type Database } from '@ghar/db'
import { env } from '@/lib/env'

// Kept on globalThis so hot reloads in development reuse one connection pool.
const globalForDb = globalThis as typeof globalThis & { gharDb?: Database }

/** The shared Drizzle client. apps/web is the only workspace allowed to import @ghar/db. */
export function getDb(): Database {
  globalForDb.gharDb ??= createDb(env().DATABASE_URL)
  return globalForDb.gharDb
}
