import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '../../src/schema';

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
`;

export async function createTestDatabase() {
  const client = new PGlite();
  await client.exec(SUPABASE_SHIM);
  const db = drizzle({ client, schema, casing: 'snake_case' });
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') });
  // Supabase grants these on every public table, leaving RLS as the only gate. Do the same so
  // the policies are what the tests exercise.
  await client.exec(
    'grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;',
  );
  return { client, db };
}

export async function createAuthUser(client: PGlite, email: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'insert into auth.users (email) values ($1) returning id',
    [email],
  );
  const [row] = rows;
  if (!row) throw new Error('auth.users insert returned no row');
  return row.id;
}

/** Runs SQL as a Supabase API role: `authenticated` for a user id, `anon` for null. */
export async function queryAs<T>(
  client: PGlite,
  userId: string | null,
  text: string,
): Promise<T[]> {
  return client.transaction(async (tx) => {
    await tx.exec(userId ? 'set local role authenticated' : 'set local role anon');
    if (userId) {
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    }
    const { rows } = await tx.query<T>(text);
    return rows;
  });
}
