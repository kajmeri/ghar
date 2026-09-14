import { relations } from 'drizzle-orm';
import {
  bigint,
  doublePrecision,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { bookingKind } from './enums';
import { households } from './households';
import { trips } from './trips';

/**
 * A reservation the household holds. Bookings arrive on their own (forwarded confirmation
 * email, manual entry) and are attached to a trip afterwards, which is why `tripId` is
 * nullable: an unlinked booking is the thing the travel hub asks you to file.
 */
export const bookings = pgTable(
  'bookings',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Null until someone files it under a trip. Clearing a trip releases its bookings. */
    tripId: uuid().references(() => trips.id, { onDelete: 'set null' }),
    kind: bookingKind().notNull(),
    title: text().notNull(),
    /** Airline, hotel chain, rental company. */
    provider: text(),
    confirmationCode: text(),
    startsAt: timestamp({ withTimezone: true }),
    endsAt: timestamp({ withTimezone: true }),
    /** Departure airport, pickup city. Null for a booking that does not move you. */
    origin: text(),
    destination: text(),
    address: text(),
    lat: doublePrecision(),
    lng: doublePrecision(),
    costCents: bigint({ mode: 'number' }),
    url: text(),
    notes: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // "Which bookings still need a trip?" on the travel hub.
    index('bookings_household_trip_idx').on(table.householdId, table.tripId, table.startsAt),
  ],
).enableRLS();

export const bookingsRelations = relations(bookings, ({ one }) => ({
  household: one(households, { fields: [bookings.householdId], references: [households.id] }),
  trip: one(trips, { fields: [bookings.tripId], references: [trips.id] }),
}));
