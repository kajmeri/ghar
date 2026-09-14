import { HOUSEHOLD_ROLES } from '@ghar/core/auth';
import { BANK_ENVIRONMENTS, BANK_ITEM_STATUSES } from '@ghar/core/banking';
import {
  ATTENDEE_RESPONSES,
  CALENDAR_PROVIDERS,
  EVENT_CATEGORIES,
  EVENT_COLOR_TOKENS,
  EVENT_DESCRIPTION_MAX_LENGTH,
  EVENT_LOCATION_MAX_LENGTH,
  EVENT_TITLE_MAX_LENGTH,
  LINK_DIRECTIONS,
  LINK_STATUSES,
  type EventColorToken,
} from '@ghar/core/calendar';
import {
  BUDGET_PERIOD_TYPES,
  CATEGORY_COLOR_TOKENS,
  CATEGORY_KINDS,
  CATEGORY_MATCHER_TYPES,
  CATEGORY_SOURCES,
  MATCHER_VALUE_MAX_LENGTH,
  MAX_PLANNED_CENTS,
  type CategoryColorToken,
  type CategoryIcon,
} from '@ghar/core/finances';
import {
  BOOKING_KINDS,
  BOOKING_SOURCES,
  BOOKING_STATUSES,
  CABINS,
  CONFIRMATION_CODE_MAX_LENGTH,
  MAX_BOOKING_CENTS,
  MAX_TRAVELERS,
  PLACE_MAX_LENGTH,
  PRICE_CONFIDENCES,
  PROPERTY_NAME_MAX_LENGTH,
  PROVIDER_NAME_MAX_LENGTH,
  RATE_PLANS,
  type Cabin,
} from '@ghar/core/travel';
import { ITINERARY_KINDS } from '@ghar/core/itinerary';
import { TRIP_STATUSES } from '@ghar/core/trips';
import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { authUsers } from 'drizzle-orm/supabase';

// Row-level security policies are hand-written SQL at the end of the migration that creates
// each table in packages/db/drizzle. Every table here has RLS enabled. No table has a write
// policy: writes go through the data access layer on the server connection, never through
// PostgREST.

export const householdRole = pgEnum('household_role', HOUSEHOLD_ROLES);
export const jobStatus = pgEnum('job_status', ['running', 'succeeded', 'failed']);
export const bankEnvironment = pgEnum('bank_environment', BANK_ENVIRONMENTS);
export const plaidItemStatus = pgEnum('plaid_item_status', BANK_ITEM_STATUSES);
export const categoryKind = pgEnum('category_kind', CATEGORY_KINDS);
export const categoryMatcherType = pgEnum('category_matcher_type', CATEGORY_MATCHER_TYPES);
export const categorySource = pgEnum('category_source', CATEGORY_SOURCES);
export const budgetPeriodType = pgEnum('budget_period_type', BUDGET_PERIOD_TYPES);
export const bookingKind = pgEnum('booking_kind', BOOKING_KINDS);
export const bookingStatus = pgEnum('booking_status', BOOKING_STATUSES);
export const bookingRatePlan = pgEnum('booking_rate_plan', RATE_PLANS);
export const bookingSource = pgEnum('booking_source', BOOKING_SOURCES);
export const priceConfidence = pgEnum('price_confidence', PRICE_CONFIDENCES);
export const eventCategory = pgEnum('event_category', EVENT_CATEGORIES);
export const attendeeResponse = pgEnum('attendee_response', ATTENDEE_RESPONSES);
export const calendarProvider = pgEnum('calendar_provider', CALENDAR_PROVIDERS);
export const calendarLinkDirection = pgEnum('calendar_link_direction', LINK_DIRECTIONS);
export const calendarLinkStatus = pgEnum('calendar_link_status', LINK_STATUSES);
export const tripStatus = pgEnum('trip_status', TRIP_STATUSES);
export const itineraryItemKind = pgEnum('itinerary_item_kind', ITINERARY_KINDS);

const timestamptz = () => timestamp({ withTimezone: true });
const metadata = () =>
  jsonb()
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`);
const cents = () => bigint({ mode: 'number' });

/** `column in ('a', 'b')` for a fixed list from @ghar/core. Never for request input. */
function inList(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} in (${sql.raw(values.map((value) => `'${value}'`).join(', '))})`;
}

export const households = pgTable(
  'households',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    /** IANA zone. Every date in the household renders in it. */
    timezone: text().notNull(),
    /** ISO 4217 code. */
    currency: char({ length: 3 }).notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    check('households_name_length', sql`char_length(${table.name}) between 1 and 80`),
    check('households_currency_code', sql`${table.currency} ~ '^[A-Z]{3}$'`),
  ],
).enableRLS();

/** One per Supabase auth user. Email lives on auth.users and is read from there. */
export const profiles = pgTable('profiles', {
  id: uuid()
    .primaryKey()
    .references(() => authUsers.id, { onDelete: 'cascade' }),
  fullName: text(),
  avatarUrl: text(),
  createdAt: timestamptz().notNull().defaultNow(),
}).enableRLS();

export const householdMembers = pgTable(
  'household_members',
  {
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    role: householdRole().notNull(),
    joinedAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.householdId, table.userId] }),
    // One household per person, so a session resolves to exactly one household.
    unique('household_members_user_id_unique').on(table.userId),
  ],
).enableRLS();

export const invitations = pgTable(
  'invitations',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    email: text().notNull(),
    role: householdRole().notNull(),
    /** SHA-256 of the emailed token. The token itself is never stored. */
    tokenHash: text().notNull(),
    expiresAt: timestamptz().notNull(),
    acceptedAt: timestamptz(),
    invitedBy: uuid().references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    unique('invitations_token_hash_unique').on(table.tokenHash),
    check('invitations_email_lowercase', sql`${table.email} = lower(${table.email})`),
    check('invitations_role_not_owner', sql`${table.role} <> 'owner'`),
    // At most one open invitation per address. Re-inviting replaces its token.
    uniqueIndex('invitations_pending_email_unique')
      .on(table.householdId, table.email)
      .where(sql`${table.acceptedAt} is null`),
  ],
).enableRLS();

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Null for work nobody signed in did: a cron sync, a webhook. */
    actorUserId: uuid().references(() => profiles.id, { onDelete: 'set null' }),
    /** Dotted verb, such as `member.role_changed`. */
    action: text().notNull(),
    entity: text().notNull(),
    entityId: text(),
    metadata: metadata(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    index('audit_log_household_created_idx').on(table.householdId, table.createdAt.desc()),
  ],
).enableRLS();

/** One row per cron run. Not household-scoped, so no policy: only the server reads it. */
export const jobRuns = pgTable(
  'job_runs',
  {
    id: uuid().primaryKey().defaultRandom(),
    jobName: text().notNull(),
    startedAt: timestamptz().notNull().defaultNow(),
    finishedAt: timestamptz(),
    status: jobStatus().notNull().default('running'),
    error: text(),
    metadata: metadata(),
  },
  (table) => [index('job_runs_job_started_idx').on(table.jobName, table.startedAt.desc())],
).enableRLS();

/**
 * A household's categories, two levels deep. The default tree is created with the household.
 * Categories are archived, never deleted, so old transactions and budgets keep their meaning.
 */
export const categories = pgTable(
  'categories',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    /** Only a top-level category can be a parent. The data access layer enforces the depth. */
    parentId: uuid().references((): AnyPgColumn => categories.id, { onDelete: 'restrict' }),
    kind: categoryKind().notNull(),
    /** A name from CATEGORY_ICONS in @ghar/core/finances. */
    icon: text().$type<CategoryIcon>().notNull(),
    colorToken: text().$type<CategoryColorToken>().notNull().default('ink-muted'),
    /** The default category this was seeded as. How Plaid's categories find it. */
    systemKey: text(),
    sortOrder: integer().notNull().default(0),
    isArchived: boolean().notNull().default(false),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('categories_household_name_unique').on(
      table.householdId,
      sql`lower(${table.name})`,
    ),
    uniqueIndex('categories_household_system_key_unique')
      .on(table.householdId, table.systemKey)
      .where(sql`${table.systemKey} is not null`),
    index('categories_parent_idx').on(table.parentId),
    check('categories_name_length', sql`char_length(${table.name}) between 1 and 40`),
    check('categories_not_own_parent', sql`${table.parentId} <> ${table.id}`),
    check('categories_color_token', inList(table.colorToken, CATEGORY_COLOR_TOKENS)),
  ],
).enableRLS();

/** A household's own categorization rules. The first layer of the waterfall. */
export const categoryRules = pgTable(
  'category_rules',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    matcherType: categoryMatcherType().notNull(),
    /** Normalized by normalizeMatcherValue, so two spellings of one rule collide. */
    matcherValue: text().notNull(),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    /** Higher runs first, after exact merchant rules. */
    priority: integer().notNull().default(0),
    createdByUserId: uuid().references(() => profiles.id, { onDelete: 'set null' }),
    /** Transactions this rule has categorized. */
    hitCount: integer().notNull().default(0),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    unique('category_rules_matcher_unique').on(
      table.householdId,
      table.matcherType,
      table.matcherValue,
    ),
    index('category_rules_category_idx').on(table.categoryId),
    check(
      'category_rules_matcher_value_length',
      sql`char_length(${table.matcherValue}) between 1 and ${sql.raw(String(MATCHER_VALUE_MAX_LENGTH))}`,
    ),
  ],
).enableRLS();

/**
 * One per bank connection (a Plaid Item). Rows are never deleted: production Items are a
 * lifetime allowance, and this table is how Ghar counts them. That is also why a household
 * with connections cannot be deleted.
 *
 * No RLS policy, so API roles cannot read it at all. It holds the access token.
 */
export const plaidItems = pgTable(
  'plaid_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'restrict' }),
    /** Which Plaid the Item lives in. `fake` is the in-process provider for keyless dev. */
    environment: bankEnvironment().notNull(),
    plaidItemId: text().notNull(),
    institutionId: text(),
    institutionName: text(),
    /** AES-256-GCM ciphertext from apps/web/lib/crypto.ts. Never select into a response. */
    accessTokenEncrypted: text().notNull(),
    /** The /transactions/sync cursor after the last applied sync. Null before the first. */
    cursor: text(),
    status: plaidItemStatus().notNull().default('good'),
    lastSyncedAt: timestamptz(),
    consentExpiresAt: timestamptz(),
    /** Plaid's error_code from the last failure, cleared by a successful sync. */
    errorCode: text(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    unique('plaid_items_plaid_item_id_unique').on(table.plaidItemId),
    index('plaid_items_household_idx').on(table.householdId),
  ],
).enableRLS();

export const accounts = pgTable(
  'accounts',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Ghar's plaid_items.id, not Plaid's Item ID. */
    plaidItemId: uuid()
      .notNull()
      .references(() => plaidItems.id, { onDelete: 'cascade' }),
    plaidAccountId: text().notNull(),
    name: text().notNull(),
    officialName: text(),
    mask: text(),
    /** Plaid's account type: depository, credit, loan, investment, other. */
    type: text().notNull(),
    subtype: text(),
    /** As Plaid reports it: what is owed on credit and loan accounts, held on the rest. */
    currentBalanceCents: cents(),
    availableBalanceCents: cents(),
    isoCurrency: char({ length: 3 }),
    isHidden: boolean().notNull().default(false),
    balanceUpdatedAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    unique('accounts_item_plaid_account_unique').on(table.plaidItemId, table.plaidAccountId),
    index('accounts_household_idx').on(table.householdId),
  ],
).enableRLS();

export const transactions = pgTable(
  'transactions',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Null, with plaidTransactionId, on a charge somebody typed in by hand. */
    accountId: uuid().references(() => accounts.id, { onDelete: 'cascade' }),
    plaidTransactionId: text(),
    /** On a posted transaction, the pending one it replaced. */
    pendingTransactionId: text(),
    /** Negative is money out, positive is money in. Plaid's sign is flipped on the way in. */
    amountCents: cents().notNull(),
    isoCurrency: char({ length: 3 }),
    date: date({ mode: 'string' }).notNull(),
    authorizedDate: date({ mode: 'string' }),
    merchantName: text(),
    name: text().notNull(),
    paymentChannel: text(),
    plaidCategoryPrimary: text(),
    plaidCategoryDetailed: text(),
    /** Plaid's confidence in its category: VERY_HIGH, HIGH, MEDIUM, LOW or UNKNOWN. */
    plaidCategoryConfidence: text(),
    categoryId: uuid().references(() => categories.id, { onDelete: 'set null' }),
    /**
     * Which layer set the category. `user` with no category means a person cleared it on purpose,
     * and nothing automatic touches it again.
     */
    categorySource: categorySource(),
    /** The model's confidence as a whole percent. Null for every other source. */
    categoryConfidence: smallint(),
    categoryRuleId: uuid().references(() => categoryRules.id, { onDelete: 'set null' }),
    /** The model's low-confidence guess, offered first in the review queue. */
    suggestedCategoryId: uuid().references(() => categories.id, { onDelete: 'set null' }),
    /** Automatic categorization couldn't decide. Waits for a person. */
    needsReview: boolean().notNull().default(false),
    isPending: boolean().notNull().default(false),
    isTransfer: boolean().notNull().default(false),
    /** Left out of spending totals. Set by a person, never by a sync. */
    isExcluded: boolean().notNull().default(false),
    notes: text(),
    /** The trip this charge counts toward. Deleting the trip keeps the charge. */
    tripId: uuid().references((): AnyPgColumn => trips.id, { onDelete: 'set null' }),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    unique('transactions_plaid_transaction_id_unique').on(table.plaidTransactionId),
    index('transactions_trip_idx')
      .on(table.tripId)
      .where(sql`${table.tripId} is not null`),
    // A bank row has both, a hand-entered one has neither.
    check(
      'transactions_manual_or_plaid',
      sql`(${table.accountId} is null) = (${table.plaidTransactionId} is null)`,
    ),
    index('transactions_household_date_idx').on(
      table.householdId,
      table.date.desc(),
      table.id.desc(),
    ),
    index('transactions_account_date_idx').on(table.accountId, table.date.desc()),
    // The review queue and rule backfills.
    index('transactions_household_uncategorized_idx')
      .on(table.householdId, table.date.desc())
      .where(sql`${table.categoryId} is null`),
    check('transactions_notes_length', sql`char_length(${table.notes}) <= 500`),
    check('transactions_category_confidence', sql`${table.categoryConfidence} between 0 and 100`),
    check(
      'transactions_category_has_source',
      sql`${table.categoryId} is null or ${table.categorySource} is not null`,
    ),
    check(
      'transactions_review_uncategorized',
      sql`not (${table.needsReview} and ${table.categoryId} is not null)`,
    ),
  ],
).enableRLS();

/** Who changed what on a transaction. Bank updates are not edits and never land here. */
export const transactionEdits = pgTable(
  'transaction_edits',
  {
    id: uuid().primaryKey().defaultRandom(),
    transactionId: uuid()
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    userId: uuid().references(() => profiles.id, { onDelete: 'set null' }),
    field: text().notNull(),
    oldValue: text(),
    newValue: text(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    index('transaction_edits_transaction_idx').on(table.transactionId, table.createdAt.desc()),
    check(
      'transaction_edits_field',
      sql`${table.field} in ('category_id', 'notes', 'is_excluded')`,
    ),
  ],
).enableRLS();

/**
 * A household's plan for one period. A closed month stores what it spent outside its lines, and
 * each line stores its actual, so closing freezes the month against later bank changes.
 */
export const budgets = pgTable(
  'budgets',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** The first day of the month. */
    periodStart: date({ mode: 'string' }).notNull(),
    periodType: budgetPeriodType().notNull().default('monthly'),
    closedAt: timestamptz(),
    unbudgetedCents: cents(),
    uncategorizedCents: cents(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    unique('budgets_household_period_unique').on(table.householdId, table.periodStart),
    check('budgets_period_start_first_day', sql`extract(day from ${table.periodStart}) = 1`),
    check(
      'budgets_closed_snapshot',
      sql`(${table.closedAt} is null) = (${table.unbudgetedCents} is null)
        and (${table.closedAt} is null) = (${table.uncategorizedCents} is null)`,
    ),
  ],
).enableRLS();

/** What a budget plans for one expense category, and a child category without its own line. */
export const budgetLines = pgTable(
  'budget_lines',
  {
    id: uuid().primaryKey().defaultRandom(),
    budgetId: uuid()
      .notNull()
      .references(() => budgets.id, { onDelete: 'cascade' }),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    plannedCents: cents().notNull(),
    rolloverEnabled: boolean().notNull().default(false),
    /** What the previous closed month left on this line, negative when it overspent. */
    rolloverInCents: cents().notNull().default(0),
    /** Set when the month closes. */
    actualCents: cents(),
  },
  (table) => [
    unique('budget_lines_budget_category_unique').on(table.budgetId, table.categoryId),
    index('budget_lines_category_idx').on(table.categoryId),
    check(
      'budget_lines_planned_cents',
      sql`${table.plannedCents} between 0 and ${sql.raw(String(MAX_PLANNED_CENTS))}`,
    ),
  ],
).enableRLS();

export const goals = pgTable(
  'goals',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    targetCents: cents().notNull(),
    targetDate: date({ mode: 'string' }),
    /** Progress is this account's balance. */
    linkedAccountId: uuid().references(() => accounts.id, { onDelete: 'set null' }),
    notes: text(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    index('goals_household_idx').on(table.householdId),
    check('goals_name_length', sql`char_length(${table.name}) between 1 and 80`),
    check(
      'goals_target_cents',
      sql`${table.targetCents} between 1 and ${sql.raw(String(MAX_PLANNED_CENTS))}`,
    ),
    check('goals_notes_length', sql`char_length(${table.notes}) <= 500`),
  ],
).enableRLS();

/**
 * A flight, hotel stay or car rental. Which columns apply depends on the kind; validateBooking in
 * @ghar/core/travel clears the rest, and the checks below hold the shape.
 */
export const bookings = pgTable(
  'bookings',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    kind: bookingKind().notNull(),
    status: bookingStatus().notNull().default('booked'),
    confirmationCode: text(),
    /** Who it was booked through. The rental company for a car. */
    providerName: text(),
    /** Two-character IATA airline code. Flights only. */
    carrier: text(),
    /** A value from CABINS in @ghar/core/travel. Flights only. */
    cabin: text().$type<Cabin>(),
    /** Stays and rentals only. A flight records whether it's refundable instead. */
    ratePlan: bookingRatePlan(),
    refundable: boolean().notNull().default(false),
    /** The departure airport for a flight, the pick-up location for a car. */
    origin: text(),
    /** The arrival airport for a flight, the city for a hotel, the drop-off for a car. */
    destination: text(),
    propertyName: text(),
    /** Check-in, or pick-up for a car. */
    checkIn: date({ mode: 'string' }),
    /** Check-out, or drop-off for a car. */
    checkOut: date({ mode: 'string' }),
    departAt: timestamptz(),
    returnAt: timestamptz(),
    travelers: smallint().notNull().default(1),
    /** The total for everyone on the booking, in `currency`. */
    paidCents: cents().notNull(),
    currency: char({ length: 3 }).notNull(),
    source: bookingSource().notNull().default('manual'),
    /** The email a parsed booking came from, so parsing it twice can't make two bookings. */
    sourceMessageId: text(),
    /** What the email parser extracted, kept to debug a wrong booking. */
    rawExtract: jsonb().$type<Record<string, unknown>>(),
    watchEnabled: boolean().notNull().default(true),
    /** The trip it's filed under. Deleting the trip keeps the booking. */
    tripId: uuid().references((): AnyPgColumn => trips.id, { onDelete: 'set null' }),
    /** Who entered it. Price-drop emails go to them, or to the owners once they've left. */
    createdBy: uuid().references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    index('bookings_household_idx').on(table.householdId),
    index('bookings_household_trip_idx').on(table.householdId, table.tripId),
    // The daily price watch.
    index('bookings_watched_idx')
      .on(table.householdId)
      .where(sql`${table.watchEnabled} and ${table.status} = 'booked'`),
    uniqueIndex('bookings_source_message_unique')
      .on(table.householdId, table.sourceMessageId)
      .where(sql`${table.sourceMessageId} is not null`),
    check(
      'bookings_travelers',
      sql`${table.travelers} between 1 and ${sql.raw(String(MAX_TRAVELERS))}`,
    ),
    check(
      'bookings_paid_cents',
      sql`${table.paidCents} between 1 and ${sql.raw(String(MAX_BOOKING_CENTS))}`,
    ),
    check('bookings_currency_code', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check('bookings_carrier_code', sql`${table.carrier} ~ '^[A-Z0-9]{2}$'`),
    check(
      'bookings_airport_codes',
      sql`${table.kind} <> 'flight' or (${table.origin} ~ '^[A-Z]{3}$' and ${table.destination} ~ '^[A-Z]{3}$')`,
    ),
    check('bookings_cabin', inList(table.cabin, CABINS)),
    check(
      'bookings_text_lengths',
      sql`char_length(${table.confirmationCode}) <= ${sql.raw(String(CONFIRMATION_CODE_MAX_LENGTH))}
        and char_length(${table.providerName}) <= ${sql.raw(String(PROVIDER_NAME_MAX_LENGTH))}
        and char_length(${table.propertyName}) <= ${sql.raw(String(PROPERTY_NAME_MAX_LENGTH))}
        and char_length(${table.origin}) <= ${sql.raw(String(PLACE_MAX_LENGTH))}
        and char_length(${table.destination}) <= ${sql.raw(String(PLACE_MAX_LENGTH))}`,
    ),
    check(
      'bookings_flight_shape',
      sql`${table.kind} <> 'flight' or (
        ${table.carrier} is not null and ${table.cabin} is not null
        and ${table.origin} is not null and ${table.destination} is not null
        and ${table.departAt} is not null and ${table.ratePlan} is null
        and ${table.checkIn} is null and ${table.checkOut} is null
      )`,
    ),
    check(
      'bookings_stay_shape',
      sql`${table.kind} = 'flight' or (
        ${table.ratePlan} is not null and ${table.checkIn} is not null
        and ${table.checkOut} is not null and ${table.departAt} is null
        and ${table.returnAt} is null and ${table.carrier} is null and ${table.cabin} is null
        and ${table.refundable} = (${table.ratePlan} = 'refundable')
      )`,
    ),
    check(
      'bookings_hotel_property',
      sql`${table.kind} <> 'hotel' or ${table.propertyName} is not null`,
    ),
    check('bookings_return_after_depart', sql`${table.returnAt} > ${table.departAt}`),
    check(
      'bookings_check_out_after_check_in',
      sql`case when ${table.kind} = 'hotel' then ${table.checkOut} > ${table.checkIn}
        else ${table.checkOut} >= ${table.checkIn} end`,
    ),
  ],
).enableRLS();

/**
 * The organizing layer above bookings. A trip starts as an idea with no dates, gains dates when
 * it's planned, and collects bookings, itinerary items, packing and spend.
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
    budgetCents: cents(),
    notes: text(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
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

/** Who is going. A household member not on this list still sees the trip. */
export const tripMembers = pgTable(
  'trip_members',
  {
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tripId, table.userId] }),
    index('trip_members_user_idx').on(table.userId),
  ],
).enableRLS();

/**
 * One row on a day's timeline. `day` is stored rather than derived from `startsAt`, so a note can
 * sit on a day without a time and an overnight flight stays on the day you leave.
 */
export const itineraryItems = pgTable(
  'itinerary_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    day: date({ mode: 'string' }).notNull(),
    startsAt: timestamptz(),
    endsAt: timestamptz(),
    kind: itineraryItemKind().notNull(),
    title: text().notNull(),
    location: text(),
    address: text(),
    lat: doublePrecision(),
    lng: doublePrecision(),
    confirmationCode: text(),
    costCents: cents(),
    /** Set when the item was generated from a booking. Deleting the booking leaves the item. */
    bookingId: uuid().references(() => bookings.id, { onDelete: 'set null' }),
    url: text(),
    notes: text(),
    /** Position within a day. Gaps are intentional; see SORT_ORDER_STEP in @ghar/core. */
    sortOrder: integer().notNull().default(0),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    index('itinerary_items_trip_day_idx').on(table.tripId, table.day, table.sortOrder),
    // Generating from bookings twice must not duplicate. Every null bookingId is distinct, so
    // hand-written items are unaffected.
    uniqueIndex('itinerary_items_trip_booking_idx').on(table.tripId, table.bookingId),
  ],
).enableRLS();

/** One vote per member, stored as a map so a second vote replaces the first. */
export type IdeaVotes = Record<string, 'up' | 'down'>;

/** The idea board. Ideas belong to the household, not a trip; promoting one creates a trip. */
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
    votes: jsonb()
      .$type<IdeaVotes>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdByUserId: uuid().references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [index('trip_ideas_household_idx').on(table.householdId, table.createdAt)],
).enableRLS();

/** One shared list per trip. An unassigned item is the household's to pick up. */
export const packingItems = pgTable(
  'packing_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    label: text().notNull(),
    assignedUserId: uuid().references(() => profiles.id, { onDelete: 'set null' }),
    isPacked: boolean().notNull().default(false),
    /** Free text, not an enum: every household groups its bags differently. */
    category: text(),
    sortOrder: integer().notNull().default(0),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [index('packing_items_trip_idx').on(table.tripId, table.sortOrder)],
).enableRLS();

/** A reusable list: "Beach week", "Carry-on only". Owned by the household, not a trip. */
export const packingTemplates = pgTable(
  'packing_templates',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
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

/** Every price the watch looked up, failures included. The price history chart reads these. */
export const priceChecks = pgTable(
  'price_checks',
  {
    id: uuid().primaryKey().defaultRandom(),
    bookingId: uuid()
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    checkedAt: timestamptz().notNull().defaultNow(),
    /** The adapter asked: `fake`, `travelpayouts`, and so on. */
    provider: text().notNull(),
    /** The total for everyone on the booking. Null when the check failed. */
    priceCents: cents(),
    confidence: priceConfidence().notNull(),
    success: boolean().notNull(),
    /** Why a check failed, in our words. Never a vendor's response body. */
    error: text(),
  },
  (table) => [
    index('price_checks_booking_checked_idx').on(table.bookingId, table.checkedAt.desc()),
    check(
      'price_checks_outcome',
      sql`(${table.success} and ${table.priceCents} > 0 and ${table.error} is null)
        or (not ${table.success} and ${table.priceCents} is null and ${table.error} is not null)`,
    ),
    check('price_checks_error_length', sql`char_length(${table.error}) <= 500`),
  ],
).enableRLS();

/**
 * A price-drop email that went out. Its floor is the price it reported: the next alert for the
 * booking has to beat the lowest floor by another full step.
 */
export const priceAlerts = pgTable(
  'price_alerts',
  {
    id: uuid().primaryKey().defaultRandom(),
    bookingId: uuid()
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    sentAt: timestamptz().notNull().defaultNow(),
    priceCents: cents().notNull(),
    /** The price minus what was paid. Always negative. */
    deltaCents: cents().notNull(),
    floorCents: cents().notNull(),
  },
  (table) => [
    index('price_alerts_booking_sent_idx').on(table.bookingId, table.sentAt.desc()),
    check('price_alerts_drop', sql`${table.deltaCents} < 0`),
    check('price_alerts_prices', sql`${table.priceCents} > 0 and ${table.floorCents} > 0`),
  ],
).enableRLS();

/**
 * One person's connected calendar. OAuth is per person: each member links their own Google
 * account, and its events join the household calendar. The link belongs to the membership, so a
 * member who leaves takes their link and its synced events with them.
 *
 * No RLS policy, so API roles cannot read it at all. It holds the refresh token.
 */
export const calendarLinks = pgTable(
  'calendar_links',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    provider: calendarProvider().notNull(),
    /** The Google account it signed in as, shown so a person knows which one is linked. */
    accountEmail: text().notNull(),
    /** AES-256-GCM ciphertext from apps/web/lib/crypto.ts. Never select into a response. */
    refreshTokenEncrypted: text().notNull(),
    calendarId: text().notNull(),
    /** Google's nextSyncToken after the last applied sync. Null before the first, or after a 410. */
    syncToken: text(),
    /** Only `inbound` is offered. Two-way sync is a later change. */
    direction: calendarLinkDirection().notNull().default('inbound'),
    /** `needs_reconnect` after Google refuses the refresh token. Syncing stops until then. */
    status: calendarLinkStatus().notNull().default('active'),
    /** Why the last sync failed, in our words. Never a vendor's response body. */
    lastError: text(),
    lastSyncedAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    unique('calendar_links_user_calendar_unique').on(
      table.userId,
      table.provider,
      table.calendarId,
    ),
    index('calendar_links_household_idx').on(table.householdId),
    foreignKey({
      name: 'calendar_links_membership_fk',
      columns: [table.householdId, table.userId],
      foreignColumns: [householdMembers.householdId, householdMembers.userId],
    }).onDelete('cascade'),
    check('calendar_links_last_error_length', sql`char_length(${table.lastError}) <= 500`),
  ],
).enableRLS();

/**
 * A native event, or one synced in from a linked calendar. Synced events carry the provider's id
 * and are only ever changed by a sync. Bill, maintenance and trip dates are not stored here: the
 * calendar feed derives them when it's read.
 *
 * All-day events start at 00:00 UTC on their first day and end at 00:00 UTC the day after their
 * last, so they're dates that don't move with the household's zone.
 */
export const events = pgTable(
  'events',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    description: text(),
    location: text(),
    startsAt: timestamptz().notNull(),
    /** Exclusive. Equal to startsAt for an event with no length. */
    endsAt: timestamptz().notNull(),
    allDay: boolean().notNull().default(false),
    /** RFC 5545 RRULE without the `RRULE:` prefix, normalized by @ghar/core/calendar. Native only. */
    rrule: text(),
    category: eventCategory().notNull().default('household'),
    /** A value from EVENT_COLOR_TOKENS. Null renders in ink. */
    colorToken: text().$type<EventColorToken>(),
    createdBy: uuid().references(() => profiles.id, { onDelete: 'set null' }),
    externalSource: calendarProvider(),
    /** The provider's event id. With singleEvents, each instance of a repeating event has its own. */
    externalId: text(),
    externalCalendarId: text(),
    /** The link that synced it. Removing the link removes its events. */
    calendarLinkId: uuid().references(() => calendarLinks.id, { onDelete: 'cascade' }),
    /** When a sync last wrote this row. A full resync removes rows it didn't reach. */
    lastSyncedAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    index('events_household_starts_idx').on(table.householdId, table.startsAt),
    // Repeating events are read by where they start alone; their end says nothing about later occurrences.
    index('events_household_recurring_idx')
      .on(table.householdId)
      .where(sql`${table.rrule} is not null`),
    // What makes sync idempotent: one row per provider event per link.
    uniqueIndex('events_link_external_unique')
      .on(table.calendarLinkId, table.externalId)
      .where(sql`${table.externalId} is not null`),
    check(
      'events_title_length',
      sql`char_length(${table.title}) between 1 and ${sql.raw(String(EVENT_TITLE_MAX_LENGTH))}`,
    ),
    check(
      'events_text_lengths',
      sql`char_length(${table.description}) <= ${sql.raw(String(EVENT_DESCRIPTION_MAX_LENGTH))}
        and char_length(${table.location}) <= ${sql.raw(String(EVENT_LOCATION_MAX_LENGTH))}`,
    ),
    check('events_ends_after_starts', sql`${table.endsAt} >= ${table.startsAt}`),
    check(
      'events_all_day_whole_days',
      sql`not ${table.allDay} or (
        ${table.endsAt} > ${table.startsAt}
        and (${table.startsAt} at time zone 'UTC')::time = '00:00'
        and (${table.endsAt} at time zone 'UTC')::time = '00:00'
      )`,
    ),
    check('events_color_token', inList(table.colorToken, EVENT_COLOR_TOKENS)),
    check(
      'events_external_shape',
      sql`(
        ${table.externalSource} is null and ${table.externalId} is null
        and ${table.externalCalendarId} is null and ${table.calendarLinkId} is null
        and ${table.lastSyncedAt} is null
      ) or (
        ${table.externalSource} is not null and ${table.externalId} is not null
        and ${table.externalCalendarId} is not null and ${table.calendarLinkId} is not null
        and ${table.lastSyncedAt} is not null and ${table.rrule} is null
      )`,
    ),
  ],
).enableRLS();

/** Household members on a native event, and how each answered. */
export const eventAttendees = pgTable(
  'event_attendees',
  {
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    response: attendeeResponse().notNull().default('needs_action'),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.userId] }),
    index('event_attendees_user_idx').on(table.userId),
  ],
).enableRLS();
