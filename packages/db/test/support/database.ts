import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import * as schema from '../../src/schema'

// The parts of Supabase the migrations and policies rely on: its API roles, auth.users, and
// auth.uid(), which Supabase reads from the verified JWT and this reads from a setting.
const SUPABASE_SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email varchar(255),
    raw_user_meta_data jsonb,
    created_at timestamptz not null default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth, public to anon, authenticated, service_role;
`

export const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '../../drizzle')

// PGlite turns a Date parameter into a timestamp on its own. Drizzle's postgres-js driver, which the
// app runs on, switches that off and relies on the column to convert, so a Date in a raw sql`...`
// template fails there and nowhere else. Fail here too.
const refuseDate = (value: unknown): string => {
  if (value instanceof Date) {
    throw new TypeError('A Date reached the driver without a column to convert it. Compare against the column (gte, lt) instead of interpolating it into sql`...`.')
  }
  return String(value)
}
const DATE_TYPE_OIDS = [1082, 1083, 1114, 1184, 1266] // date, time, timestamp, timestamptz, timetz
const serializers = Object.fromEntries(DATE_TYPE_OIDS.map(oid => [oid, refuseDate]))

/** `migrationsFolder` lets a test stop at an older schema, to check what a later migration does to its data. */
export async function createTestDatabase({ migrationsFolder = MIGRATIONS_FOLDER }: { migrationsFolder?: string } = {}) {
  const client = new PGlite({ serializers })
  await client.exec(SUPABASE_SHIM)
  const db = drizzle({ client, schema, casing: 'snake_case' })
  await migrate(db, { migrationsFolder })
  // Supabase grants these on every public table, leaving RLS as the only gate. Do the same so
  // the policies are what the tests exercise.
  await client.exec('grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;')
  return { client, db }
}

export async function createAuthUser(client: PGlite, email: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [email])
  const [row] = rows
  if (!row) throw new Error('auth.users insert returned no row')
  return row.id
}

/** Runs SQL as a Supabase API role: `authenticated` for a user id, `anon` for null. */
export async function queryAs<T>(client: PGlite, userId: string | null, text: string): Promise<T[]> {
  return client.transaction(async tx => {
    await tx.exec(userId ? 'set local role authenticated' : 'set local role anon')
    if (userId) {
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId])
    }
    const { rows } = await tx.query<T>(text)
    return rows
  })
}
