import { index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { householdRole } from './enums';

/**
 * Supabase owns `auth.users`, and Drizzle only manages `public`, so user ids are plain
 * uuid columns here with no foreign key. The session is the only thing that produces one.
 */

export const households = pgTable('households', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  /** IANA zone. Every date without a time is rendered in it. */
  timeZone: text().notNull().default('America/New_York'),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const householdMembers = pgTable(
  'household_members',
  {
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid().notNull(),
    role: householdRole().notNull().default('member'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.householdId, table.userId] }),
    // The lookup every request makes: session user id -> household and role.
    index('household_members_user_idx').on(table.userId),
  ],
).enableRLS();
