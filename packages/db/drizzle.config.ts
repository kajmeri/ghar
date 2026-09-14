import { existsSync } from 'node:fs'
import { defineConfig } from 'drizzle-kit'

if (existsSync('.env')) process.loadEnvFile('.env')

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  // Checked in. Never edit a migration that has been applied.
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: {
    // Only `db:migrate` connects. Use Supabase's direct or session-pooler URL here;
    // the transaction pooler cannot run migrations.
    url: process.env.DATABASE_URL ?? '',
  },
  // Supabase owns auth, storage and friends. Drizzle manages public only.
  schemaFilter: ['public'],
  entities: { roles: { provider: 'supabase' } },
  migrations: { schema: 'drizzle', table: '__drizzle_migrations' },
  strict: true,
  verbose: true,
})
