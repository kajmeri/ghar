import 'server-only';
import { createDb, type Database } from '@casa/db';

let db: Database | undefined;

/** The shared Drizzle client. apps/web is the only workspace allowed to import @casa/db. */
export function getDb(): Database {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set. Copy apps/web/.env.example to .env.local.');
    db = createDb(url);
  }
  return db;
}
