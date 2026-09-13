import 'server-only';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = ReturnType<typeof createDb>;

/**
 * Creates the Drizzle client. Call once per server process.
 * `prepare: false` is required by Supabase's transaction pooler.
 */
export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, { prepare: false });
  return drizzle({ client, schema, casing: 'snake_case' });
}

export { schema };
