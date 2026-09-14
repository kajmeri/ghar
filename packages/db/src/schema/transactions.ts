import { relations } from 'drizzle-orm';
import { bigint, date, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { households } from './households';
import { trips } from './trips';

/**
 * Household spending. Money out is negative, money in is positive, always integer cents.
 *
 * `tripId` is the trip tag: it is what turns a pile of card charges into a trip's actual
 * spend. A refund posted against a trip is a positive amount and reduces that spend, which
 * is why `tripActualCents` in @casa/core negates the sum rather than filtering on sign.
 */
export const transactions = pgTable(
  'transactions',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Calendar date, no time: the day the charge posted. */
    postedOn: date({ mode: 'string' }).notNull(),
    description: text().notNull(),
    merchant: text(),
    amountCents: bigint({ mode: 'number' }).notNull(),
    /** The trip tag. Null for everyday spending. Clearing a trip untags its transactions. */
    tripId: uuid().references(() => trips.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('transactions_household_posted_idx').on(table.householdId, table.postedOn),
    // Summing a trip's actual spend.
    index('transactions_trip_idx').on(table.tripId),
  ],
).enableRLS();

export const transactionsRelations = relations(transactions, ({ one }) => ({
  household: one(households, { fields: [transactions.householdId], references: [households.id] }),
  trip: one(trips, { fields: [transactions.tripId], references: [trips.id] }),
}));
