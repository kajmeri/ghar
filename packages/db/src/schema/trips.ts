import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { bookings } from './bookings';
import { itineraryItemKind, tripStatus } from './enums';
import { households } from './households';

/**
 * The organizing layer above bookings. A trip starts as an idea with no dates, gains
 * dates when it is planned, and collects bookings, itinerary items, packing and spend.
 */
export const trips = pgTable(
  'trips',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    destination: text(),
    /** Calendar dates, no zone. Null while the trip is still an idea. */
    startsOn: date({ mode: 'string' }),
    endsOn: date({ mode: 'string' }),
    status: tripStatus().notNull().default('idea'),
    coverImageUrl: text(),
    /** What the household means to spend. Actual comes from tagged transactions. */
    budgetCents: bigint({ mode: 'number' }),
    notes: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('trips_household_starts_idx').on(table.householdId, table.startsOn),
    // Either both dates or neither, and never backwards.
    check(
      'trips_dates_valid',
      sql`(${table.startsOn} is null) = (${table.endsOn} is null) and (${table.endsOn} is null or ${table.endsOn} >= ${table.startsOn})`,
    ),
  ],
).enableRLS();

/** Who is going. A household member not on this list still sees the trip; they are just not on it. */
export const tripMembers = pgTable(
  'trip_members',
  {
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    userId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tripId, table.userId] })],
).enableRLS();

/**
 * One row on a day's timeline. `day` is what groups the timeline, and it is stored rather
 * than derived from `startsAt` so a note or an all-day activity can sit on a day without
 * a time, and so an overnight flight stays on the day you leave.
 */
export const itineraryItems = pgTable(
  'itinerary_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    day: date({ mode: 'string' }).notNull(),
    startsAt: timestamp({ withTimezone: true }),
    endsAt: timestamp({ withTimezone: true }),
    kind: itineraryItemKind().notNull(),
    title: text().notNull(),
    location: text(),
    address: text(),
    lat: doublePrecision(),
    lng: doublePrecision(),
    confirmationCode: text(),
    costCents: bigint({ mode: 'number' }),
    /** Set when the item was generated from a booking. Deleting the booking leaves the item. */
    bookingId: uuid().references(() => bookings.id, { onDelete: 'set null' }),
    url: text(),
    notes: text(),
    /** Position within a day. Gaps are intentional; see SORT_ORDER_STEP in @casa/core. */
    sortOrder: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('itinerary_items_trip_day_idx').on(table.tripId, table.day, table.sortOrder),
    // Generating from bookings twice must not duplicate. Postgres treats every NULL
    // bookingId as distinct, so hand-written items are unaffected by this index.
    uniqueIndex('itinerary_items_trip_booking_idx').on(table.tripId, table.bookingId),
  ],
).enableRLS();

export const tripsRelations = relations(trips, ({ one, many }) => ({
  household: one(households, { fields: [trips.householdId], references: [households.id] }),
  members: many(tripMembers),
  itineraryItems: many(itineraryItems),
  bookings: many(bookings),
}));

export const tripMembersRelations = relations(tripMembers, ({ one }) => ({
  trip: one(trips, { fields: [tripMembers.tripId], references: [trips.id] }),
}));

export const itineraryItemsRelations = relations(itineraryItems, ({ one }) => ({
  trip: one(trips, { fields: [itineraryItems.tripId], references: [trips.id] }),
  booking: one(bookings, { fields: [itineraryItems.bookingId], references: [bookings.id] }),
}));
