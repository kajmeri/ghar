import { relations } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { households } from './households';

/** One vote per member, stored as a map so a second vote replaces the first. */
export type IdeaVotes = Record<string, 'up' | 'down'>;

/**
 * The idea board. Ideas belong to the household rather than to a trip, because the point
 * is the pile of places nobody has committed to yet. Promoting one creates a trip.
 */
export const tripIdeas = pgTable(
  'trip_ideas',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    destination: text(),
    url: text(),
    notes: text(),
    /** From the pasted link's OpenGraph tags, when it had any. */
    imageUrl: text(),
    votes: jsonb().$type<IdeaVotes>().notNull().default({}),
    createdByUserId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('trip_ideas_household_idx').on(table.householdId, table.createdAt)],
).enableRLS();

export const tripIdeasRelations = relations(tripIdeas, ({ one }) => ({
  household: one(households, { fields: [tripIdeas.householdId], references: [households.id] }),
}));
