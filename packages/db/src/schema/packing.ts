import { relations } from 'drizzle-orm';
import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { households } from './households';
import { trips } from './trips';

/**
 * One shared list per trip. `assignedUserId` is nullable: an unassigned item is the
 * household's to pick up, and that is the default when a template is applied.
 */
export const packingItems = pgTable(
  'packing_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    label: text().notNull(),
    assignedUserId: uuid(),
    isPacked: boolean().notNull().default(false),
    /** Free text, not an enum: every household groups its bags differently. */
    category: text(),
    sortOrder: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('packing_items_trip_idx').on(table.tripId, table.sortOrder)],
).enableRLS();

/** A reusable list. "Beach week", "Ski", "Carry-on only". Owned by the household, not a trip. */
export const packingTemplates = pgTable(
  'packing_templates',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('packing_templates_household_idx').on(table.householdId)],
).enableRLS();

export const packingTemplateItems = pgTable(
  'packing_template_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    templateId: uuid()
      .notNull()
      .references(() => packingTemplates.id, { onDelete: 'cascade' }),
    label: text().notNull(),
    category: text(),
    sortOrder: integer().notNull().default(0),
  },
  (table) => [index('packing_template_items_template_idx').on(table.templateId, table.sortOrder)],
).enableRLS();

export const packingItemsRelations = relations(packingItems, ({ one }) => ({
  trip: one(trips, { fields: [packingItems.tripId], references: [trips.id] }),
}));

export const packingTemplatesRelations = relations(packingTemplates, ({ one, many }) => ({
  household: one(households, {
    fields: [packingTemplates.householdId],
    references: [households.id],
  }),
  items: many(packingTemplateItems),
}));

export const packingTemplateItemsRelations = relations(packingTemplateItems, ({ one }) => ({
  template: one(packingTemplates, {
    fields: [packingTemplateItems.templateId],
    references: [packingTemplates.id],
  }),
}));
