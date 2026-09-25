import { HOUSEHOLD_ROLES } from '@ghar/core/auth'
import { GUEST_RESPONSES, GUEST_SOURCES, MAX_PARTY_SIZE } from '@ghar/core/trip-guests'
import { POLL_KINDS, POLL_PLACE_MAX_LENGTH } from '@ghar/core/trip-polls'
import { ARRIVAL_DIRECTIONS, ARRIVAL_MODES, ARRIVAL_NUMBER_MAX_LENGTH, ARRIVAL_PLACE_MAX_LENGTH } from '@ghar/core/trip-arrivals'
import { COST_DESCRIPTION_MAX_LENGTH, COST_MAX_CENTS, COST_SHARES_MAX } from '@ghar/core/trip-costs'
import { ROOM_NAME_MAX_LENGTH, ROOM_SLEEPS_MAX } from '@ghar/core/trip-rooms'
import { TRIP_POST_MAX_LENGTH, TRIP_UPDATE_KINDS } from '@ghar/core/trip-updates'
import { BANK_ENVIRONMENTS, BANK_ITEM_STATUSES } from '@ghar/core/banking'
import { BILL_CADENCES, BILL_NAME_MAX_LENGTH, BILL_NOTES_MAX_LENGTH, BILL_PAYEE_MAX_LENGTH, MAX_BILL_CENTS } from '@ghar/core/bills'
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
} from '@ghar/core/calendar'
import {
  CONTACT_EMAIL_MAX_LENGTH,
  CONTACT_NAME_MAX_LENGTH,
  CONTACT_NOTES_MAX_LENGTH,
  CONTACT_PHONE_MAX_LENGTH,
  CONTACT_ROLE_MAX_LENGTH,
  CONTACT_TAG_MAX_LENGTH,
  MAX_CONTACT_TAGS,
} from '@ghar/core/contacts'
import {
  DOCUMENT_FIELD_MAX_LENGTH,
  DOCUMENT_KINDS,
  DOCUMENT_MIME_TYPES,
  DOCUMENT_NOTES_MAX_LENGTH,
  DOCUMENT_TITLE_MAX_LENGTH,
  MAX_DOCUMENT_BYTES,
  type DocumentMimeType,
} from '@ghar/core/documents'
import {
  BUDGET_PERIOD_TYPES,
  CATEGORY_COLOR_TOKENS,
  CATEGORY_KINDS,
  CATEGORY_MATCHER_TYPES,
  CATEGORY_SOURCES,
  isLiabilityKind,
  LIABILITY_KINDS,
  MANUAL_ACCOUNT_KINDS,
  MANUAL_ACCOUNT_NAME_MAX_LENGTH,
  MANUAL_NOTES_MAX_LENGTH,
  MANUAL_VALUE_SOURCES,
  MATCHER_VALUE_MAX_LENGTH,
  MAX_MANUAL_VALUE_CENTS,
  MAX_PLANNED_CENTS,
  MAX_REMINDER_CADENCE_MONTHS,
  NETWORTH_SNAPSHOT_SOURCES,
  type CategoryColorToken,
  type CategoryIcon,
  type LiabilityKind,
  type ManualAccountKind,
  type ManualValueSource,
  type NetWorthSnapshotSource,
} from '@ghar/core/finances'
import {
  ASSET_FIELD_MAX_LENGTH,
  ASSET_KINDS,
  ASSET_NAME_MAX_LENGTH,
  HOME_NOTES_MAX_LENGTH,
  MAINTENANCE_TITLE_MAX_LENGTH,
  MAX_ASSET_CENTS,
  MAX_CADENCE_MILES,
  MAX_CADENCE_MONTHS,
  MAX_MAINTENANCE_COST_CENTS,
} from '@ghar/core/home'
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
} from '@ghar/core/travel'
import { COST_BASES, OPTION_SOURCES, OPTION_STATUSES, OPTION_VOTES, SLOT_BANDS, SLOT_KINDS, SLOT_STATUSES } from '@ghar/core/itinerary'
import {
  MAX_RENEWAL_CADENCE_MONTHS,
  MAX_RENEWAL_CENTS,
  RENEWAL_FIELD_MAX_LENGTH,
  RENEWAL_KINDS,
  RENEWAL_NOTES_MAX_LENGTH,
  RENEWAL_TITLE_MAX_LENGTH,
} from '@ghar/core/renewals'
import { REMINDER_LEAD_DAYS_MAX, REMINDER_LEAD_DAYS_MIN } from '@ghar/core/expiries'
import { TRIP_STATUSES } from '@ghar/core/trips'
import { DIGEST_SECTIONS, ONE_TAP_ACTIONS, oneTapActionHasDate, type DigestSection } from '@ghar/core/digest'
import { BOOKING_DRAFT_STATUSES, MAIL_LINK_STATUSES, MAIL_MESSAGE_OUTCOMES, MAIL_SUBJECT_MAX_LENGTH } from '@ghar/core/mail'
import { PERSON_NAME_MAX_LENGTH } from '@ghar/core/people'
import { SYNC_ENTITIES, type SyncEntity } from '@ghar/core/sync'
import { sql, type SQL } from 'drizzle-orm'
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
  numeric,
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
} from 'drizzle-orm/pg-core'
import { authUsers } from 'drizzle-orm/supabase'

// Row-level security policies are hand-written SQL at the end of the migration that creates
// each table in packages/db/drizzle. Every table here has RLS enabled. No table has a write
// policy: writes go through the data access layer on the server connection, never through
// PostgREST.
//
// Sync (migration 0008): `updated_at` is set by a trigger on insert and on any update that changes the
// row, so app code never has to remember it. Deleting a row a client can hold writes a tombstone to
// sync_tombstones, and a change to a child a client sees inside its parent (a vote inside an itinerary
// slot) bumps the parent's `updated_at`.

export const householdRole = pgEnum('household_role', HOUSEHOLD_ROLES)
export const jobStatus = pgEnum('job_status', ['running', 'succeeded', 'failed'])
export const bankEnvironment = pgEnum('bank_environment', BANK_ENVIRONMENTS)
export const plaidItemStatus = pgEnum('plaid_item_status', BANK_ITEM_STATUSES)
export const categoryKind = pgEnum('category_kind', CATEGORY_KINDS)
export const categoryMatcherType = pgEnum('category_matcher_type', CATEGORY_MATCHER_TYPES)
export const categorySource = pgEnum('category_source', CATEGORY_SOURCES)
export const budgetPeriodType = pgEnum('budget_period_type', BUDGET_PERIOD_TYPES)
export const bookingKind = pgEnum('booking_kind', BOOKING_KINDS)
export const bookingStatus = pgEnum('booking_status', BOOKING_STATUSES)
export const bookingRatePlan = pgEnum('booking_rate_plan', RATE_PLANS)
export const bookingSource = pgEnum('booking_source', BOOKING_SOURCES)
export const priceConfidence = pgEnum('price_confidence', PRICE_CONFIDENCES)
export const eventCategory = pgEnum('event_category', EVENT_CATEGORIES)
export const attendeeResponse = pgEnum('attendee_response', ATTENDEE_RESPONSES)
export const calendarProvider = pgEnum('calendar_provider', CALENDAR_PROVIDERS)
export const calendarLinkDirection = pgEnum('calendar_link_direction', LINK_DIRECTIONS)
export const calendarLinkStatus = pgEnum('calendar_link_status', LINK_STATUSES)
export const tripStatus = pgEnum('trip_status', TRIP_STATUSES)
export const tripGuestResponse = pgEnum('trip_guest_response', GUEST_RESPONSES)
export const tripGuestSource = pgEnum('trip_guest_source', GUEST_SOURCES)
export const itinerarySlotBand = pgEnum('itinerary_slot_band', SLOT_BANDS)
export const itinerarySlotKind = pgEnum('itinerary_slot_kind', SLOT_KINDS)
export const itinerarySlotStatus = pgEnum('itinerary_slot_status', SLOT_STATUSES)
export const itineraryOptionStatus = pgEnum('itinerary_option_status', OPTION_STATUSES)
export const itineraryCostBasis = pgEnum('itinerary_cost_basis', COST_BASES)
export const itineraryOptionSource = pgEnum('itinerary_option_source', OPTION_SOURCES)
export const optionVoteValue = pgEnum('option_vote', OPTION_VOTES)
export const tripPollKind = pgEnum('trip_poll_kind', POLL_KINDS)
export const tripUpdateKind = pgEnum('trip_update_kind', TRIP_UPDATE_KINDS)
export const tripArrivalDirection = pgEnum('trip_arrival_direction', ARRIVAL_DIRECTIONS)
export const tripArrivalMode = pgEnum('trip_arrival_mode', ARRIVAL_MODES)
export const documentKind = pgEnum('document_kind', DOCUMENT_KINDS)
export const assetKind = pgEnum('asset_kind', ASSET_KINDS)
export const billCadence = pgEnum('bill_cadence', BILL_CADENCES)
export const mailLinkStatus = pgEnum('mail_link_status', MAIL_LINK_STATUSES)
export const mailMessageOutcome = pgEnum('mail_message_outcome', MAIL_MESSAGE_OUTCOMES)
export const bookingDraftStatus = pgEnum('booking_draft_status', BOOKING_DRAFT_STATUSES)
export const oneTapAction = pgEnum('one_tap_action', ONE_TAP_ACTIONS)
export const renewalKind = pgEnum('renewal_kind', RENEWAL_KINDS)

const timestamptz = () => timestamp({ withTimezone: true })
const metadata = () =>
  jsonb()
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`)
const cents = () => bigint({ mode: 'number' })
/** A reminder lead time, or a reminder sent at one: `between` this. */
const REMINDER_LEAD_RANGE = `${String(REMINDER_LEAD_DAYS_MIN)} and ${String(REMINDER_LEAD_DAYS_MAX)}`

/** `column in ('a', 'b')` for a fixed list from @ghar/core. Never for request input. */
function inList(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} in (${sql.raw(values.map(value => `'${value}'`).join(', '))})`
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
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    check('households_name_length', sql`char_length(${table.name}) between 1 and 80`),
    check('households_currency_code', sql`${table.currency} ~ '^[A-Z]{3}$'`),
  ]
).enableRLS()

/** One per Supabase auth user. Email lives on auth.users and is read from there. */
export const profiles = pgTable('profiles', {
  id: uuid()
    .primaryKey()
    .references(() => authUsers.id, { onDelete: 'cascade' }),
  fullName: text(),
  avatarUrl: text(),
  createdAt: timestamptz().notNull().defaultNow(),
}).enableRLS()

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
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    primaryKey({ columns: [table.householdId, table.userId] }),
    // One household per person, so a session resolves to exactly one household.
    unique('household_members_user_id_unique').on(table.userId),
  ]
).enableRLS()

/**
 * The household's people: every member, and anyone without an account who things belong to, like
 * a child with a passport. A member's row points at their account and takes its name from there;
 * anyone else has a name of their own. When a member leaves, their row keeps the name they had and
 * lets go of the account, so their documents and trips still say whose they were.
 */
export const householdPeople = pgTable(
  'household_people',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Null for someone without an account. Deleting the account deletes the person with it. */
    userId: uuid().references(() => profiles.id, { onDelete: 'cascade' }),
    /** Only for someone without an account. A member's name comes from their profile. */
    name: text(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    index('household_people_household_idx').on(table.householdId),
    // A member is one person, and belongs to one household anyway.
    unique('household_people_user_id_unique').on(table.userId),
    check('household_people_account_or_name', sql`(${table.userId} is null) = (${table.name} is not null)`),
    check('household_people_name_length', sql`char_length(${table.name}) between 1 and ${sql.raw(String(PERSON_NAME_MAX_LENGTH))}`),
  ]
).enableRLS()

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
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    index('invitations_household_idx').on(table.householdId),
    index('invitations_invited_by_idx')
      .on(table.invitedBy)
      .where(sql`${table.invitedBy} is not null`),
    unique('invitations_token_hash_unique').on(table.tokenHash),
    check('invitations_email_lowercase', sql`${table.email} = lower(${table.email})`),
    check('invitations_role_not_owner', sql`${table.role} <> 'owner'`),
    // At most one open invitation per address. Re-inviting replaces its token.
    uniqueIndex('invitations_pending_email_unique')
      .on(table.householdId, table.email)
      .where(sql`${table.acceptedAt} is null`),
  ]
).enableRLS()

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
  table => [
    index('audit_log_household_created_idx').on(table.householdId, table.createdAt.desc()),
    index('audit_log_actor_idx')
      .on(table.actorUserId)
      .where(sql`${table.actorUserId} is not null`),
  ]
).enableRLS()

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
  table => [index('job_runs_job_started_idx').on(table.jobName, table.startedAt.desc())]
).enableRLS()

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
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    uniqueIndex('categories_household_name_unique').on(table.householdId, sql`lower(${table.name})`),
    uniqueIndex('categories_household_system_key_unique')
      .on(table.householdId, table.systemKey)
      .where(sql`${table.systemKey} is not null`),
    index('categories_parent_idx').on(table.parentId),
    check('categories_name_length', sql`char_length(${table.name}) between 1 and 40`),
    check('categories_not_own_parent', sql`${table.parentId} <> ${table.id}`),
    check('categories_color_token', inList(table.colorToken, CATEGORY_COLOR_TOKENS)),
  ]
).enableRLS()

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
  table => [
    unique('category_rules_matcher_unique').on(table.householdId, table.matcherType, table.matcherValue),
    index('category_rules_category_idx').on(table.categoryId),
    index('category_rules_created_by_idx')
      .on(table.createdByUserId)
      .where(sql`${table.createdByUserId} is not null`),
    check(
      'category_rules_matcher_value_length',
      sql`char_length(${table.matcherValue}) between 1 and ${sql.raw(String(MATCHER_VALUE_MAX_LENGTH))}`
    ),
  ]
).enableRLS()

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
    /**
     * AES-256-GCM ciphertext from apps/web/lib/crypto.ts. Never select into a response. Null once
     * the connection is disconnected: the token is revoked at Plaid, and a dead credential is not
     * worth keeping.
     */
    accessTokenEncrypted: text(),
    /** The /transactions/sync cursor after the last applied sync. Null before the first. */
    cursor: text(),
    status: plaidItemStatus().notNull().default('good'),
    lastSyncedAt: timestamptz(),
    consentExpiresAt: timestamptz(),
    /** Plaid's error_code from the last failure, cleared by a successful sync. */
    errorCode: text(),
    /** When somebody turned the connection off. What it brought in stays until asked to go. */
    disconnectedAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  table => [unique('plaid_items_plaid_item_id_unique').on(table.plaidItemId), index('plaid_items_household_idx').on(table.householdId)]
).enableRLS()

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
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    unique('accounts_item_plaid_account_unique').on(table.plaidItemId, table.plaidAccountId),
    index('accounts_household_idx').on(table.householdId),
  ]
).enableRLS()

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
  table => [
    unique('transactions_plaid_transaction_id_unique').on(table.plaidTransactionId),
    index('transactions_trip_idx')
      .on(table.tripId)
      .where(sql`${table.tripId} is not null`),
    // A bank row has both, a hand-entered one has neither.
    check('transactions_manual_or_plaid', sql`(${table.accountId} is null) = (${table.plaidTransactionId} is null)`),
    index('transactions_household_date_idx').on(table.householdId, table.date.desc(), table.id.desc()),
    index('transactions_account_date_idx').on(table.accountId, table.date.desc()),
    index('transactions_category_idx')
      .on(table.categoryId)
      .where(sql`${table.categoryId} is not null`),
    index('transactions_category_rule_idx')
      .on(table.categoryRuleId)
      .where(sql`${table.categoryRuleId} is not null`),
    index('transactions_suggested_category_idx')
      .on(table.suggestedCategoryId)
      .where(sql`${table.suggestedCategoryId} is not null`),
    // The review queue and rule backfills.
    index('transactions_household_uncategorized_idx')
      .on(table.householdId, table.date.desc())
      .where(sql`${table.categoryId} is null`),
    check('transactions_notes_length', sql`char_length(${table.notes}) <= 500`),
    check('transactions_category_confidence', sql`${table.categoryConfidence} between 0 and 100`),
    check('transactions_category_has_source', sql`${table.categoryId} is null or ${table.categorySource} is not null`),
    check('transactions_review_uncategorized', sql`not (${table.needsReview} and ${table.categoryId} is not null)`),
  ]
).enableRLS()

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
  table => [
    index('transaction_edits_transaction_idx').on(table.transactionId, table.createdAt.desc()),
    index('transaction_edits_user_idx')
      .on(table.userId)
      .where(sql`${table.userId} is not null`),
    check('transaction_edits_field', sql`${table.field} in ('category_id', 'notes', 'is_excluded')`),
  ]
).enableRLS()

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
  table => [
    unique('budgets_household_period_unique').on(table.householdId, table.periodStart),
    check('budgets_period_start_first_day', sql`extract(day from ${table.periodStart}) = 1`),
    check(
      'budgets_closed_snapshot',
      sql`(${table.closedAt} is null) = (${table.unbudgetedCents} is null)
        and (${table.closedAt} is null) = (${table.uncategorizedCents} is null)`
    ),
  ]
).enableRLS()

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
  table => [
    unique('budget_lines_budget_category_unique').on(table.budgetId, table.categoryId),
    index('budget_lines_category_idx').on(table.categoryId),
    check('budget_lines_planned_cents', sql`${table.plannedCents} between 0 and ${sql.raw(String(MAX_PLANNED_CENTS))}`),
  ]
).enableRLS()

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
  table => [
    index('goals_household_idx').on(table.householdId),
    index('goals_linked_account_idx')
      .on(table.linkedAccountId)
      .where(sql`${table.linkedAccountId} is not null`),
    check('goals_name_length', sql`char_length(${table.name}) between 1 and 80`),
    check('goals_target_cents', sql`${table.targetCents} between 1 and ${sql.raw(String(MAX_PLANNED_CENTS))}`),
    check('goals_notes_length', sql`char_length(${table.notes}) <= 500`),
  ]
).enableRLS()

// ---------------------------------------------------------------------------------------------
// Net worth. Signs follow BALANCE_SIGN in @ghar/core/finances: a snapshot stores what a balance adds
// to net worth, negative for money owed, so nothing that reads one looks at an account's type.

/**
 * Something the household owns or owes that no bank connection covers: the house, a car, a 401k at
 * an institution nobody linked. Its value is a history in manual_values, never overwritten.
 */
export const manualAccounts = pgTable(
  'manual_accounts',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    kind: text().$type<ManualAccountKind>().notNull(),
    /** Follows from the kind. Stored so a reader can split owned from owed without the sign table. */
    isLiability: boolean().notNull(),
    notes: text(),
    /** Months after the newest value that the digest asks for a new one. Null for never. */
    reminderCadenceMonths: smallint(),
    /** Left out of today's net worth and the reminders. Its history stays. */
    archivedAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    index('manual_accounts_household_name_idx').on(table.householdId, sql`lower(${table.name})`, table.id),
    check('manual_accounts_kind', inList(table.kind, MANUAL_ACCOUNT_KINDS)),
    check(
      'manual_accounts_is_liability',
      sql`${table.isLiability} = (${inList(table.kind, MANUAL_ACCOUNT_KINDS.filter(isLiabilityKind))})`
    ),
    check('manual_accounts_name_length', sql`char_length(${table.name}) between 1 and ${sql.raw(String(MANUAL_ACCOUNT_NAME_MAX_LENGTH))}`),
    check('manual_accounts_notes_length', sql`char_length(${table.notes}) <= ${sql.raw(String(MANUAL_NOTES_MAX_LENGTH))}`),
    check(
      'manual_accounts_reminder_cadence',
      sql`${table.reminderCadenceMonths} between 1 and ${sql.raw(String(MAX_REMINDER_CADENCE_MONTHS))}`
    ),
  ]
).enableRLS()

/**
 * One value of a manual account as of a date. Updating an estimate adds a row; the newest on or before
 * a day is that day's value. Never negative: for a loan it is what's still owed.
 */
export const manualValues = pgTable(
  'manual_values',
  {
    id: uuid().primaryKey().defaultRandom(),
    manualAccountId: uuid()
      .notNull()
      .references(() => manualAccounts.id, { onDelete: 'cascade' }),
    asOf: date({ mode: 'string' }).notNull(),
    valueCents: cents().notNull(),
    source: text().$type<ManualValueSource>().notNull().default('manual'),
    notes: text(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    // Two values on one day: the one entered later wins.
    index('manual_values_account_as_of_idx').on(table.manualAccountId, table.asOf.desc(), table.createdAt.desc(), table.id.desc()),
    check('manual_values_value', sql`${table.valueCents} between 0 and ${sql.raw(String(MAX_MANUAL_VALUE_CENTS))}`),
    check('manual_values_source', inList(table.source, MANUAL_VALUE_SOURCES)),
    check('manual_values_notes_length', sql`char_length(${table.notes}) <= ${sql.raw(String(MANUAL_NOTES_MAX_LENGTH))}`),
  ]
).enableRLS()

/**
 * One account's reading for a day, connected or manual, written by the daily snapshot job. A balance
 * that couldn't be refreshed is carried forward with `isStale`, never left out and never written as
 * zero. Running the job again the same day updates the row.
 */
export const accountSnapshots = pgTable(
  'account_snapshots',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Set for a connected account, with source 'plaid'. */
    accountId: uuid().references(() => accounts.id, { onDelete: 'cascade' }),
    /** Set for a manual account, with source 'manual'. */
    manualAccountId: uuid().references(() => manualAccounts.id, { onDelete: 'cascade' }),
    asOf: date({ mode: 'string' }).notNull(),
    /** Signed: positive for what's owned, negative for what's owed. */
    balanceCents: cents().notNull(),
    isStale: boolean().notNull().default(false),
    source: text().$type<'plaid' | 'manual'>().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    unique('account_snapshots_account_as_of_unique').on(table.accountId, table.asOf),
    unique('account_snapshots_manual_account_as_of_unique').on(table.manualAccountId, table.asOf),
    index('account_snapshots_household_as_of_idx').on(table.householdId, table.asOf),
    check('account_snapshots_one_account', sql`num_nonnulls(${table.accountId}, ${table.manualAccountId}) = 1`),
    check(
      'account_snapshots_source',
      sql`(${table.source} = 'plaid' and ${table.accountId} is not null) or (${table.source} = 'manual' and ${table.manualAccountId} is not null)`
    ),
  ]
).enableRLS()

/**
 * A household's net worth for a day. `automatic` rows roll up that day's account_snapshots; `manual`
 * rows are history typed in from old records, dated before tracking began, with no accounts behind them.
 */
export const networthSnapshots = pgTable(
  'networth_snapshots',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    asOf: date({ mode: 'string' }).notNull(),
    assetsCents: cents().notNull(),
    /** Signed, zero or below. */
    liabilitiesCents: cents().notNull(),
    netCents: cents().notNull(),
    accountCount: integer().notNull(),
    /** Accounts carried forward on this day, so the chart can say the number is partly old. */
    staleAccountCount: integer().notNull(),
    source: text().$type<NetWorthSnapshotSource>().notNull().default('automatic'),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    unique('networth_snapshots_household_as_of_unique').on(table.householdId, table.asOf),
    check('networth_snapshots_source', inList(table.source, NETWORTH_SNAPSHOT_SOURCES)),
    check(
      'networth_snapshots_totals',
      sql`${table.assetsCents} >= 0 and ${table.liabilitiesCents} <= 0 and ${table.netCents} = ${table.assetsCents} + ${table.liabilitiesCents}`
    ),
    check(
      'networth_snapshots_counts',
      sql`${table.staleAccountCount} between 0 and ${table.accountCount}
        and (${table.source} = 'automatic' or (${table.accountCount} = 0 and ${table.staleAccountCount} = 0))`
    ),
  ]
).enableRLS()

/**
 * An investment account's positions from /investments/holdings/get, for composition only. The
 * account's balance is its value in net worth; these are never summed into it.
 */
export const holdings = pgTable(
  'holdings',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    plaidSecurityId: text().notNull(),
    ticker: text(),
    name: text(),
    /** Plaid's security type: equity, etf, mutual fund, fixed income, cash, cryptocurrency, derivative, other. */
    securityType: text(),
    /** Shares or units. Not money, so not cents. */
    quantity: numeric({ mode: 'number' }).notNull(),
    /** What was paid for the whole position, when the institution reports it. */
    costBasisCents: cents(),
    valueCents: cents().notNull(),
    /** When the institution last priced it. */
    asOf: date({ mode: 'string' }).notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    unique('holdings_account_security_unique').on(table.accountId, table.plaidSecurityId),
    index('holdings_household_idx').on(table.householdId),
  ]
).enableRLS()

/**
 * The detail /liabilities/get adds to a credit card, student loan or mortgage. The balance still comes
 * from the account; this is the APR, the payment and when it's due.
 */
export const liabilityDetails = pgTable(
  'liability_details',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    kind: text().$type<LiabilityKind>().notNull(),
    /** A card's purchase APR, or a loan's interest rate. A rate, not money. */
    aprPercent: numeric({ mode: 'number' }),
    minimumPaymentCents: cents(),
    nextPaymentDueOn: date({ mode: 'string' }),
    lastPaymentCents: cents(),
    lastPaymentOn: date({ mode: 'string' }),
    originationDate: date({ mode: 'string' }),
    originalPrincipalCents: cents(),
    isOverdue: boolean().notNull().default(false),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    unique('liability_details_account_unique').on(table.accountId),
    index('liability_details_household_due_idx').on(table.householdId, table.nextPaymentDueOn),
    check('liability_details_kind', inList(table.kind, LIABILITY_KINDS)),
    check('liability_details_apr', sql`${table.aprPercent} between 0 and 100`),
    check(
      'liability_details_amounts',
      sql`${table.minimumPaymentCents} >= 0 and ${table.lastPaymentCents} >= 0 and ${table.originalPrincipalCents} >= 0`
    ),
  ]
).enableRLS()

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
  table => [
    index('bookings_household_trip_idx').on(table.householdId, table.tripId),
    index('bookings_trip_idx')
      .on(table.tripId)
      .where(sql`${table.tripId} is not null`),
    index('bookings_created_by_idx')
      .on(table.createdBy)
      .where(sql`${table.createdBy} is not null`),
    // The daily price watch.
    index('bookings_watched_idx')
      .on(table.householdId)
      .where(sql`${table.watchEnabled} and ${table.status} = 'booked'`),
    uniqueIndex('bookings_source_message_unique')
      .on(table.householdId, table.sourceMessageId)
      .where(sql`${table.sourceMessageId} is not null`),
    check('bookings_travelers', sql`${table.travelers} between 1 and ${sql.raw(String(MAX_TRAVELERS))}`),
    check('bookings_paid_cents', sql`${table.paidCents} between 1 and ${sql.raw(String(MAX_BOOKING_CENTS))}`),
    check('bookings_currency_code', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check('bookings_carrier_code', sql`${table.carrier} ~ '^[A-Z0-9]{2}$'`),
    check(
      'bookings_airport_codes',
      sql`${table.kind} <> 'flight' or (${table.origin} ~ '^[A-Z]{3}$' and ${table.destination} ~ '^[A-Z]{3}$')`
    ),
    check('bookings_cabin', inList(table.cabin, CABINS)),
    check(
      'bookings_text_lengths',
      sql`char_length(${table.confirmationCode}) <= ${sql.raw(String(CONFIRMATION_CODE_MAX_LENGTH))}
        and char_length(${table.providerName}) <= ${sql.raw(String(PROVIDER_NAME_MAX_LENGTH))}
        and char_length(${table.propertyName}) <= ${sql.raw(String(PROPERTY_NAME_MAX_LENGTH))}
        and char_length(${table.origin}) <= ${sql.raw(String(PLACE_MAX_LENGTH))}
        and char_length(${table.destination}) <= ${sql.raw(String(PLACE_MAX_LENGTH))}`
    ),
    check(
      'bookings_flight_shape',
      sql`${table.kind} <> 'flight' or (
        ${table.carrier} is not null and ${table.cabin} is not null
        and ${table.origin} is not null and ${table.destination} is not null
        and ${table.departAt} is not null and ${table.ratePlan} is null
        and ${table.checkIn} is null and ${table.checkOut} is null
      )`
    ),
    check(
      'bookings_stay_shape',
      sql`${table.kind} = 'flight' or (
        ${table.ratePlan} is not null and ${table.checkIn} is not null
        and ${table.checkOut} is not null and ${table.departAt} is null
        and ${table.returnAt} is null and ${table.carrier} is null and ${table.cabin} is null
        and ${table.refundable} = (${table.ratePlan} = 'refundable')
      )`
    ),
    check('bookings_hotel_property', sql`${table.kind} <> 'hotel' or ${table.propertyName} is not null`),
    check('bookings_return_after_depart', sql`${table.returnAt} > ${table.departAt}`),
    check(
      'bookings_check_out_after_check_in',
      sql`case when ${table.kind} = 'hotel' then ${table.checkOut} > ${table.checkIn}
        else ${table.checkOut} >= ${table.checkIn} end`
    ),
  ]
).enableRLS()

/**
 * The organizing layer above bookings. A trip starts as an idea with no dates, gains dates when
 * it's planned, and collects bookings, an itinerary, packing and spend.
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
    /** Leaving the country, so passports get checked. */
    international: boolean().notNull().default(false),
    notes: text(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    index('trips_household_starts_idx').on(table.householdId, table.startsOn),
    // Past trips: ends before today.
    index('trips_household_ends_idx').on(table.householdId, table.endsOn),
    // Either both dates or neither, and never backwards.
    check(
      'trips_dates_valid',
      sql`(${table.startsOn} is null) = (${table.endsOn} is null) and (${table.endsOn} is null or ${table.endsOn} >= ${table.startsOn})`
    ),
  ]
).enableRLS()

/** Who is going: household people, with or without accounts. Anyone not on this list still sees the trip. */
export const tripTravellers = pgTable(
  'trip_travellers',
  {
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    personId: uuid()
      .notNull()
      .references(() => householdPeople.id, { onDelete: 'cascade' }),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  table => [primaryKey({ columns: [table.tripId, table.personId] }), index('trip_travellers_person_idx').on(table.personId)]
).enableRLS()

/**
 * People from outside the household on a trip. A guest is an account let onto this one trip, not
 * a member of any household, so their access follows the account: starting or joining a household
 * later changes nothing here. Someone invited by email has a row from the start, with no account
 * until they answer; someone who came through the link gets a row when they answer, and waits for
 * `approved_at` when the link asks the household to let people in.
 */
export const tripGuests = pgTable(
  'trip_guests',
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    /** The address invited, or the one they signed in with through the link. Lower-cased. */
    email: text().notNull(),
    /** Null until an emailed invitation is answered. Deleting the account takes them off the trip. */
    userId: uuid().references(() => profiles.id, { onDelete: 'cascade' }),
    source: tripGuestSource().notNull(),
    /** Null until they answer. */
    response: tripGuestResponse(),
    /** The guest and whoever they bring. */
    partySize: smallint().notNull().default(1),
    /** When they were let in. Set at once for an emailed invitation. */
    approvedAt: timestamptz(),
    /** SHA-256 of the token in an emailed invitation. The token itself is never stored. */
    tokenHash: text(),
    invitedBy: uuid().references(() => profiles.id, { onDelete: 'set null' }),
    respondedAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    unique('trip_guests_trip_email_unique').on(table.tripId, table.email),
    uniqueIndex('trip_guests_trip_user_unique')
      .on(table.tripId, table.userId)
      .where(sql`${table.userId} is not null`),
    index('trip_guests_user_idx')
      .on(table.userId)
      .where(sql`${table.userId} is not null`),
    index('trip_guests_invited_by_idx')
      .on(table.invitedBy)
      .where(sql`${table.invitedBy} is not null`),
    unique('trip_guests_token_hash_unique').on(table.tokenHash),
    // For the shared costs' foreign keys, so a guest on a cost is on that cost's trip.
    unique('trip_guests_id_trip_unique').on(table.id, table.tripId),
    check('trip_guests_email_lowercase', sql`${table.email} = lower(${table.email})`),
    check('trip_guests_party_size', sql`${table.partySize} between 1 and ${sql.raw(String(MAX_PARTY_SIZE))}`),
    // An emailed invitation carries a token; someone from the link is already signed in.
    check(
      'trip_guests_source_shape',
      sql`case when ${table.source} = 'email' then ${table.tokenHash} is not null else ${table.tokenHash} is null and ${table.userId} is not null end`
    ),
    check('trip_guests_answered', sql`(${table.response} is null) = (${table.respondedAt} is null)`),
  ]
).enableRLS()

/**
 * The trip's shareable link, while it is on. The token is sealed rather than hashed so the
 * household can copy the link again; the hash is how an incoming link is found. Turning the link
 * off deletes the row, and making a new one replaces it, so an old link stops working.
 */
export const tripShareLinks = pgTable(
  'trip_share_links',
  {
    tripId: uuid()
      .primaryKey()
      .references(() => trips.id, { onDelete: 'cascade' }),
    tokenHash: text().notNull(),
    /** AES-256-GCM, from apps/web/lib/crypto.ts. */
    tokenSealed: text().notNull(),
    /** Whether people who come through the link wait for the household to let them in. */
    requiresApproval: boolean().notNull().default(true),
    createdBy: uuid().references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    unique('trip_share_links_token_hash_unique').on(table.tokenHash),
    index('trip_share_links_created_by_idx')
      .on(table.createdBy)
      .where(sql`${table.createdBy} is not null`),
  ]
).enableRLS()

/**
 * A guest's private calendar feed for one trip. Calendar apps can't sign in, so the URL is the
 * key: stored as a hash to look it up, and sealed so the guest can copy it again. Goes when they
 * come off the trip.
 */
export const tripGuestCalendarFeeds = pgTable(
  'trip_guest_calendar_feeds',
  {
    guestId: uuid()
      .primaryKey()
      .references(() => tripGuests.id, { onDelete: 'cascade' }),
    tokenHash: text().notNull(),
    /** AES-256-GCM, from apps/web/lib/crypto.ts. */
    tokenSealed: text().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [unique('trip_guest_calendar_feeds_token_hash_unique').on(table.tokenHash)]
).enableRLS()

/**
 * A stretch of a day that needs filling: "Dinner", "Morning". It holds the options being weighed
 * for it, and at most one of them is chosen. A band is enough while planning is rough, so the
 * times stay empty until someone knows them.
 */
export const itinerarySlots = pgTable(
  'itinerary_slots',
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    /** Stored rather than derived from `startsAt`, so an overnight flight stays on the day you leave. */
    day: date({ mode: 'string' }).notNull(),
    band: itinerarySlotBand().notNull(),
    kind: itinerarySlotKind().notNull(),
    label: text().notNull(),
    startsAt: timestamptz(),
    endsAt: timestamptz(),
    /** Position within a day and band. Gaps are intentional; see SORT_ORDER_STEP in @ghar/core. */
    sortOrder: integer().notNull().default(0),
    status: itinerarySlotStatus().notNull().default('open'),
    /** Always one of this slot's own options; the data access layer is what guarantees it. */
    chosenOptionId: uuid().references((): AnyPgColumn => itineraryOptions.id, { onDelete: 'set null' }),
    decideBy: date({ mode: 'string' }),
    notes: text(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    index('itinerary_slots_trip_day_idx').on(table.tripId, table.day, table.band, table.sortOrder),
    index('itinerary_slots_chosen_option_idx')
      .on(table.chosenOptionId)
      .where(sql`${table.chosenOptionId} is not null`),
    check('itinerary_slots_label_length', sql`char_length(${table.label}) between 1 and 200`),
    // Decided and booked are exactly the states that have a choice. Deleting a chosen option
    // therefore fails here unless the slot was reopened first.
    check('itinerary_slots_choice_matches_status', sql`(${table.status} in ('decided', 'booked')) = (${table.chosenOptionId} is not null)`),
  ]
).enableRLS()

/** One thing a slot could be. Rejected options are kept, so a reversed decision loses nothing. */
export const itineraryOptions = pgTable(
  'itinerary_options',
  {
    id: uuid().primaryKey().defaultRandom(),
    slotId: uuid()
      .notNull()
      .references((): AnyPgColumn => itinerarySlots.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    subtitle: text(),
    url: text(),
    imageUrl: text(),
    address: text(),
    lat: doublePrecision(),
    lng: doublePrecision(),
    /** Per person or for the party, as `costBasis` says. `optionTotalCents` in @ghar/core reads both. */
    costCents: cents(),
    costBasis: itineraryCostBasis().notNull().default('total'),
    durationMinutes: integer(),
    /** Wall-clock "HH:MM" where the place is. A close at or before the open runs past midnight. */
    opensAt: text(),
    closesAt: text(),
    /** Days of the week it is shut, 0 for Sunday. */
    closedDays: integer()
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    bookingRequired: boolean().notNull().default(false),
    bookingUrl: text(),
    bookingDeadline: date({ mode: 'string' }),
    confirmationCode: text(),
    tags: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    source: itineraryOptionSource().notNull().default('manual'),
    /** Set when the option came from a booking. Deleting the booking leaves the option. */
    bookingId: uuid().references(() => bookings.id, { onDelete: 'set null' }),
    status: itineraryOptionStatus().notNull().default('candidate'),
    sortOrder: integer().notNull().default(0),
    notes: text(),
    createdByUserId: uuid().references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    index('itinerary_options_slot_idx').on(table.slotId, table.sortOrder),
    index('itinerary_options_created_by_idx')
      .on(table.createdByUserId)
      .where(sql`${table.createdByUserId} is not null`),
    // A booking is on one trip's timeline once. Every null is distinct, so other options are unaffected.
    uniqueIndex('itinerary_options_booking_idx').on(table.bookingId),
    check(
      'itinerary_options_hours',
      sql`(${table.opensAt} is null) = (${table.closesAt} is null)
        and ${table.opensAt} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and ${table.closesAt} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`
    ),
    check('itinerary_options_closed_days', sql`${table.closedDays} <@ '{0,1,2,3,4,5,6}'::integer[]`),
    check('itinerary_options_duration_positive', sql`${table.durationMinutes} > 0`),
  ]
).enableRLS()

/** One vote per member per option. Voting again replaces it. */
export const optionVotes = pgTable(
  'option_votes',
  {
    optionId: uuid()
      .notNull()
      .references(() => itineraryOptions.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    vote: optionVoteValue().notNull(),
    comment: text(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [primaryKey({ columns: [table.optionId, table.userId] }), index('option_votes_user_idx').on(table.userId)]
).enableRLS()

/**
 * Deciding a trip together before it has dates or a place: "When works?" or "Where to?". One of
 * each at most. Everyone on the trip, household and guests, adds options and votes; the household
 * picks, which sets the trip's dates or destination and deletes the poll.
 */
export const tripPolls = pgTable(
  'trip_polls',
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    kind: tripPollKind().notNull(),
    /** When the household means to pick, in its own zone. Everyone who hasn't voted is nudged near it. */
    decideBy: date({ mode: 'string' }),
    createdByUserId: uuid().references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    unique('trip_polls_trip_kind_unique').on(table.tripId, table.kind),
    index('trip_polls_created_by_idx')
      .on(table.createdByUserId)
      .where(sql`${table.createdByUserId} is not null`),
  ]
).enableRLS()

/** A date range on a dates poll, or a place on a place poll. The data access layer matches it to the kind. */
export const tripPollOptions = pgTable(
  'trip_poll_options',
  {
    id: uuid().primaryKey().defaultRandom(),
    pollId: uuid()
      .notNull()
      .references(() => tripPolls.id, { onDelete: 'cascade' }),
    startsOn: date({ mode: 'string' }),
    endsOn: date({ mode: 'string' }),
    label: text(),
    /** A guest can take back what they added; the household can take back anything. */
    createdByUserId: uuid().references(() => profiles.id, { onDelete: 'set null' }),
    sortOrder: integer().notNull().default(0),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    index('trip_poll_options_poll_idx').on(table.pollId, table.sortOrder),
    index('trip_poll_options_created_by_idx')
      .on(table.createdByUserId)
      .where(sql`${table.createdByUserId} is not null`),
    // Dates or a place, never both or neither.
    check(
      'trip_poll_options_shape',
      sql`case when ${table.label} is null
        then ${table.startsOn} is not null and ${table.endsOn} is not null and ${table.endsOn} >= ${table.startsOn}
        else ${table.startsOn} is null and ${table.endsOn} is null end`
    ),
    check('trip_poll_options_label_length', sql`char_length(${table.label}) between 1 and ${sql.raw(String(POLL_PLACE_MAX_LENGTH))}`),
  ]
).enableRLS()

/** One vote per person per option, household or guest. Voting again replaces it. */
export const tripPollVotes = pgTable(
  'trip_poll_votes',
  {
    optionId: uuid()
      .notNull()
      .references(() => tripPollOptions.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    vote: optionVoteValue().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [primaryKey({ columns: [table.optionId, table.userId] }), index('trip_poll_votes_user_idx').on(table.userId)]
).enableRLS()

/**
 * A reminder to vote that went out: one per person, per slot or poll, per deadline, so moving the
 * deadline earns one more. The row is claimed before sending, like expiry_reminders.
 *
 * No RLS policy: only the cron job reads it.
 */
export const decisionNudges = pgTable(
  'decision_nudges',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    slotId: uuid().references(() => itinerarySlots.id, { onDelete: 'cascade' }),
    pollId: uuid().references(() => tripPolls.id, { onDelete: 'cascade' }),
    deadline: date({ mode: 'string' }).notNull(),
    sentAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    index('decision_nudges_user_idx').on(table.userId),
    uniqueIndex('decision_nudges_slot_unique')
      .on(table.slotId, table.userId, table.deadline)
      .where(sql`${table.slotId} is not null`),
    uniqueIndex('decision_nudges_poll_unique')
      .on(table.pollId, table.userId, table.deadline)
      .where(sql`${table.pollId} is not null`),
    check('decision_nudges_one_subject', sql`num_nonnulls(${table.slotId}, ${table.pollId}) = 1`),
  ]
).enableRLS()

/**
 * What's new on a trip, for the household and its guests: posts, and what the household decided,
 * which posts itself with only what guests can already see. `emailed_at` is set once it has gone
 * out, in the daily email or straight away when the household sends a post to everyone.
 */
export const tripUpdates = pgTable(
  'trip_updates',
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    kind: tripUpdateKind().notNull(),
    authorUserId: uuid().references(() => profiles.id, { onDelete: 'set null' }),
    body: text(),
    label: text(),
    day: date({ mode: 'string' }),
    endsOn: date({ mode: 'string' }),
    detail: text(),
    /** The slot a decision or booking was about, so deciding again before it's emailed replaces it. */
    slotId: uuid().references(() => itinerarySlots.id, { onDelete: 'set null' }),
    emailedAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    index('trip_updates_trip_idx').on(table.tripId, table.createdAt),
    index('trip_updates_unsent_idx')
      .on(table.tripId)
      .where(sql`${table.emailedAt} is null`),
    index('trip_updates_author_idx')
      .on(table.authorUserId)
      .where(sql`${table.authorUserId} is not null`),
    index('trip_updates_slot_idx')
      .on(table.slotId)
      .where(sql`${table.slotId} is not null`),
    check(
      'trip_updates_body',
      sql`(${table.kind} = 'post') = (${table.body} is not null) and (${table.body} is null or char_length(${table.body}) <= ${sql.raw(String(TRIP_POST_MAX_LENGTH))})`
    ),
  ]
).enableRLS()

/**
 * How someone gets to the trip and home again: one way in and one way out each, for a household
 * traveller or a guest, never both. Only the travel itself; a confirmation code, seat or price is
 * never kept. `ride_user_id` is whoever offered to pick them up or drop them off.
 */
export const tripArrivals = pgTable(
  'trip_arrivals',
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    personId: uuid().references(() => householdPeople.id, { onDelete: 'cascade' }),
    guestId: uuid().references(() => tripGuests.id, { onDelete: 'cascade' }),
    direction: tripArrivalDirection().notNull(),
    mode: tripArrivalMode().notNull(),
    at: timestamptz().notNull(),
    place: text(),
    number: text(),
    wantsRide: boolean().notNull().default(false),
    rideUserId: uuid().references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    unique('trip_arrivals_person_unique').on(table.tripId, table.personId, table.direction),
    unique('trip_arrivals_guest_unique').on(table.tripId, table.guestId, table.direction),
    index('trip_arrivals_trip_idx').on(table.tripId, table.at),
    index('trip_arrivals_person_idx')
      .on(table.personId)
      .where(sql`${table.personId} is not null`),
    index('trip_arrivals_guest_idx')
      .on(table.guestId)
      .where(sql`${table.guestId} is not null`),
    index('trip_arrivals_ride_idx')
      .on(table.rideUserId)
      .where(sql`${table.rideUserId} is not null`),
    check('trip_arrivals_one_person', sql`(${table.personId} is null) <> (${table.guestId} is null)`),
    check('trip_arrivals_ride_wanted', sql`${table.rideUserId} is null or ${table.wantsRide}`),
    check('trip_arrivals_place_length', sql`char_length(${table.place}) <= ${sql.raw(String(ARRIVAL_PLACE_MAX_LENGTH))}`),
    check('trip_arrivals_number_length', sql`char_length(${table.number}) <= ${sql.raw(String(ARRIVAL_NUMBER_MAX_LENGTH))}`),
  ]
).enableRLS()

/** Where people sleep on a trip, set up by the household. */
export const tripRooms = pgTable(
  'trip_rooms',
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    sleeps: smallint().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    index('trip_rooms_trip_idx').on(table.tripId, table.createdAt),
    // For trip_room_assignments' foreign key, so a room and its people are on the same trip.
    unique('trip_rooms_id_trip_unique').on(table.id, table.tripId),
    check('trip_rooms_name_length', sql`char_length(${table.name}) between 1 and ${sql.raw(String(ROOM_NAME_MAX_LENGTH))}`),
    check('trip_rooms_sleeps', sql`${table.sleeps} between 1 and ${sql.raw(String(ROOM_SLEEPS_MAX))}`),
  ]
).enableRLS()

/** Who is in which room. Someone is in one room at most on a trip. */
export const tripRoomAssignments = pgTable(
  'trip_room_assignments',
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    roomId: uuid().notNull(),
    personId: uuid().references(() => householdPeople.id, { onDelete: 'cascade' }),
    guestId: uuid().references(() => tripGuests.id, { onDelete: 'cascade' }),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    foreignKey({
      name: 'trip_room_assignments_room_fk',
      columns: [table.roomId, table.tripId],
      foreignColumns: [tripRooms.id, tripRooms.tripId],
    }).onDelete('cascade'),
    unique('trip_room_assignments_person_unique').on(table.tripId, table.personId),
    unique('trip_room_assignments_guest_unique').on(table.tripId, table.guestId),
    index('trip_room_assignments_room_idx').on(table.roomId, table.tripId),
    index('trip_room_assignments_person_idx')
      .on(table.personId)
      .where(sql`${table.personId} is not null`),
    index('trip_room_assignments_guest_idx')
      .on(table.guestId)
      .where(sql`${table.guestId} is not null`),
    check('trip_room_assignments_one_person', sql`(${table.personId} is null) <> (${table.guestId} is null)`),
  ]
).enableRLS()

/**
 * Something paid for on a trip that the household and its guests share. A null guest is the
 * household hosting the trip. A guest with costs or payments can't be taken off the trip until
 * those are gone, so no one's balance moves under them (no action, not restrict, so deleting the
 * whole trip still cascades). In the host household's currency.
 */
export const tripCosts = pgTable(
  'trip_costs',
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    description: text().notNull(),
    amountCents: cents().notNull(),
    /** Who paid. Null is the household. */
    paidByGuestId: uuid(),
    spentOn: date({ mode: 'string' }).notNull(),
    createdBy: uuid().references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    foreignKey({
      name: 'trip_costs_paid_by_fk',
      columns: [table.paidByGuestId, table.tripId],
      foreignColumns: [tripGuests.id, tripGuests.tripId],
    }).onDelete('no action'),
    // For trip_cost_shares' foreign key, so a share is on its cost's trip.
    unique('trip_costs_id_trip_unique').on(table.id, table.tripId),
    index('trip_costs_trip_idx').on(table.tripId, table.spentOn),
    index('trip_costs_paid_by_idx')
      .on(table.paidByGuestId, table.tripId)
      .where(sql`${table.paidByGuestId} is not null`),
    index('trip_costs_created_by_idx')
      .on(table.createdBy)
      .where(sql`${table.createdBy} is not null`),
    check(
      'trip_costs_description_length',
      sql`char_length(${table.description}) between 1 and ${sql.raw(String(COST_DESCRIPTION_MAX_LENGTH))}`
    ),
    check('trip_costs_amount', sql`${table.amountCents} between 1 and ${sql.raw(String(COST_MAX_CENTS))}`),
  ]
).enableRLS()

/** Who a cost is split between, and in what shares. A null guest is the household. */
export const tripCostShares = pgTable(
  'trip_cost_shares',
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    costId: uuid().notNull(),
    guestId: uuid(),
    shares: smallint().notNull(),
  },
  table => [
    foreignKey({
      name: 'trip_cost_shares_cost_fk',
      columns: [table.costId, table.tripId],
      foreignColumns: [tripCosts.id, tripCosts.tripId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'trip_cost_shares_guest_fk',
      columns: [table.guestId, table.tripId],
      foreignColumns: [tripGuests.id, tripGuests.tripId],
    }).onDelete('no action'),
    // The household is in a split once too.
    unique('trip_cost_shares_party_unique').on(table.costId, table.guestId).nullsNotDistinct(),
    index('trip_cost_shares_cost_idx').on(table.costId, table.tripId),
    index('trip_cost_shares_trip_idx').on(table.tripId),
    index('trip_cost_shares_guest_idx')
      .on(table.guestId, table.tripId)
      .where(sql`${table.guestId} is not null`),
    check('trip_cost_shares_shares', sql`${table.shares} between 1 and ${sql.raw(String(COST_SHARES_MAX))}`),
  ]
).enableRLS()

/** Someone paying someone else back. A null guest is the household. */
export const tripPayments = pgTable(
  'trip_payments',
  {
    id: uuid().primaryKey().defaultRandom(),
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    fromGuestId: uuid(),
    toGuestId: uuid(),
    amountCents: cents().notNull(),
    paidOn: date({ mode: 'string' }).notNull(),
    createdBy: uuid().references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    foreignKey({
      name: 'trip_payments_from_fk',
      columns: [table.fromGuestId, table.tripId],
      foreignColumns: [tripGuests.id, tripGuests.tripId],
    }).onDelete('no action'),
    foreignKey({
      name: 'trip_payments_to_fk',
      columns: [table.toGuestId, table.tripId],
      foreignColumns: [tripGuests.id, tripGuests.tripId],
    }).onDelete('no action'),
    index('trip_payments_trip_idx').on(table.tripId, table.paidOn),
    index('trip_payments_from_idx')
      .on(table.fromGuestId, table.tripId)
      .where(sql`${table.fromGuestId} is not null`),
    index('trip_payments_to_idx')
      .on(table.toGuestId, table.tripId)
      .where(sql`${table.toGuestId} is not null`),
    index('trip_payments_created_by_idx')
      .on(table.createdBy)
      .where(sql`${table.createdBy} is not null`),
    check('trip_payments_two_parties', sql`${table.fromGuestId} is distinct from ${table.toGuestId}`),
    check('trip_payments_amount', sql`${table.amountCents} between 1 and ${sql.raw(String(COST_MAX_CENTS))}`),
  ]
).enableRLS()

/** People who'd rather not get a trip's updates by email. They still see them on the trip. */
export const tripUpdateMutes = pgTable(
  'trip_update_mutes',
  {
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  table => [primaryKey({ columns: [table.tripId, table.userId] }), index('trip_update_mutes_user_idx').on(table.userId)]
).enableRLS()

/** Days where someone said no to the breakfast-lunch-dinner skeleton, so it stops being offered. */
export const itineraryScaffoldDismissals = pgTable(
  'itinerary_scaffold_dismissals',
  {
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    day: date({ mode: 'string' }).notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  table => [primaryKey({ columns: [table.tripId, table.day] })]
).enableRLS()

/** One vote per member, stored as a map so a second vote replaces the first. */
export type IdeaVotes = Record<string, 'up' | 'down'>

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
  table => [
    index('trip_ideas_household_idx').on(table.householdId, table.createdAt),
    index('trip_ideas_created_by_idx')
      .on(table.createdByUserId)
      .where(sql`${table.createdByUserId} is not null`),
  ]
).enableRLS()

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
  table => [
    index('packing_items_trip_idx').on(table.tripId, table.sortOrder),
    index('packing_items_assigned_user_idx')
      .on(table.assignedUserId)
      .where(sql`${table.assignedUserId} is not null`),
  ]
).enableRLS()

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
  table => [index('packing_templates_household_idx').on(table.householdId)]
).enableRLS()

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
  table => [index('packing_template_items_template_idx').on(table.templateId, table.sortOrder)]
).enableRLS()

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
  table => [
    index('price_checks_booking_checked_idx').on(table.bookingId, table.checkedAt.desc()),
    check(
      'price_checks_outcome',
      sql`(${table.success} and ${table.priceCents} > 0 and ${table.error} is null)
        or (not ${table.success} and ${table.priceCents} is null and ${table.error} is not null)`
    ),
    check('price_checks_error_length', sql`char_length(${table.error}) <= 500`),
  ]
).enableRLS()

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
  table => [
    index('price_alerts_booking_sent_idx').on(table.bookingId, table.sentAt.desc()),
    check('price_alerts_drop', sql`${table.deltaCents} < 0`),
    check('price_alerts_prices', sql`${table.priceCents} > 0 and ${table.floorCents} > 0`),
  ]
).enableRLS()

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
  table => [
    unique('calendar_links_user_calendar_unique').on(table.userId, table.provider, table.calendarId),
    index('calendar_links_membership_idx').on(table.householdId, table.userId),
    foreignKey({
      name: 'calendar_links_membership_fk',
      columns: [table.householdId, table.userId],
      foreignColumns: [householdMembers.householdId, householdMembers.userId],
    }).onDelete('cascade'),
    check('calendar_links_last_error_length', sql`char_length(${table.lastError}) <= 500`),
  ]
).enableRLS()

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
  table => [
    index('events_household_starts_idx').on(table.householdId, table.startsAt),
    // The window read: one-off events still running at its start.
    index('events_household_ends_idx').on(table.householdId, table.endsAt),
    index('events_calendar_link_idx')
      .on(table.calendarLinkId)
      .where(sql`${table.calendarLinkId} is not null`),
    index('events_created_by_idx')
      .on(table.createdBy)
      .where(sql`${table.createdBy} is not null`),
    // Repeating events are read by where they start alone; their end says nothing about later occurrences.
    index('events_household_recurring_idx')
      .on(table.householdId)
      .where(sql`${table.rrule} is not null`),
    // What makes sync idempotent: one row per provider event per link.
    uniqueIndex('events_link_external_unique')
      .on(table.calendarLinkId, table.externalId)
      .where(sql`${table.externalId} is not null`),
    check('events_title_length', sql`char_length(${table.title}) between 1 and ${sql.raw(String(EVENT_TITLE_MAX_LENGTH))}`),
    check(
      'events_text_lengths',
      sql`char_length(${table.description}) <= ${sql.raw(String(EVENT_DESCRIPTION_MAX_LENGTH))}
        and char_length(${table.location}) <= ${sql.raw(String(EVENT_LOCATION_MAX_LENGTH))}`
    ),
    check('events_ends_after_starts', sql`${table.endsAt} >= ${table.startsAt}`),
    check(
      'events_all_day_whole_days',
      sql`not ${table.allDay} or (
        ${table.endsAt} > ${table.startsAt}
        and (${table.startsAt} at time zone 'UTC')::time = '00:00'
        and (${table.endsAt} at time zone 'UTC')::time = '00:00'
      )`
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
      )`
    ),
  ]
).enableRLS()

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
  table => [primaryKey({ columns: [table.eventId, table.userId] }), index('event_attendees_user_idx').on(table.userId)]
).enableRLS()

/** The longest link httpUrlSchema in @ghar/contracts accepts. */
const URL_MAX_LENGTH = 2000

/** The people the household calls: the plumber, the pediatrician, the insurance agent. */
export const contacts = pgTable(
  'contacts',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    /** What they do for the household, in the household's words: "Plumber", "Pediatrician". */
    role: text(),
    phone: text(),
    email: text(),
    url: text(),
    notes: text(),
    /** Normalized by normalizeContactTags: lower case, no repeats. */
    tags: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    index('contacts_household_name_idx').on(table.householdId, sql`lower(${table.name})`),
    check('contacts_name_length', sql`char_length(${table.name}) between 1 and ${sql.raw(String(CONTACT_NAME_MAX_LENGTH))}`),
    check(
      'contacts_text_lengths',
      sql`char_length(${table.role}) <= ${sql.raw(String(CONTACT_ROLE_MAX_LENGTH))}
        and char_length(${table.phone}) <= ${sql.raw(String(CONTACT_PHONE_MAX_LENGTH))}
        and char_length(${table.email}) <= ${sql.raw(String(CONTACT_EMAIL_MAX_LENGTH))}
        and char_length(${table.url}) <= ${sql.raw(String(URL_MAX_LENGTH))}
        and char_length(${table.notes}) <= ${sql.raw(String(CONTACT_NOTES_MAX_LENGTH))}`
    ),
    check(
      'contacts_tags',
      sql`cardinality(${table.tags}) <= ${sql.raw(String(MAX_CONTACT_TAGS))}
        and char_length(array_to_string(${table.tags}, '')) <= ${sql.raw(String(MAX_CONTACT_TAGS * CONTACT_TAG_MAX_LENGTH))}`
    ),
  ]
).enableRLS()

/** Something the household owns and looks after: the car, the furnace, the dishwasher. */
export const assets = pgTable(
  'assets',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    kind: assetKind().notNull().default('other'),
    make: text(),
    model: text(),
    serialNumber: text(),
    purchasedOn: date({ mode: 'string' }),
    purchasePriceCents: cents(),
    warrantyExpiresOn: date({ mode: 'string' }),
    /** Days before the warranty ends that reminders start. Null for the default, from reminderLeadDays. */
    warrantyRemindFromDays: smallint(),
    /** Where it is, so someone can find the shutoff: "Basement, north wall". */
    location: text(),
    notes: text(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    index('assets_household_name_idx').on(table.householdId, sql`lower(${table.name})`),
    index('assets_household_warranty_idx')
      .on(table.householdId, table.warrantyExpiresOn)
      .where(sql`${table.warrantyExpiresOn} is not null`),
    check('assets_name_length', sql`char_length(${table.name}) between 1 and ${sql.raw(String(ASSET_NAME_MAX_LENGTH))}`),
    check(
      'assets_text_lengths',
      sql`char_length(${table.make}) <= ${sql.raw(String(ASSET_FIELD_MAX_LENGTH))}
        and char_length(${table.model}) <= ${sql.raw(String(ASSET_FIELD_MAX_LENGTH))}
        and char_length(${table.serialNumber}) <= ${sql.raw(String(ASSET_FIELD_MAX_LENGTH))}
        and char_length(${table.location}) <= ${sql.raw(String(ASSET_FIELD_MAX_LENGTH))}
        and char_length(${table.notes}) <= ${sql.raw(String(HOME_NOTES_MAX_LENGTH))}`
    ),
    check('assets_purchase_price', sql`${table.purchasePriceCents} between 0 and ${sql.raw(String(MAX_ASSET_CENTS))}`),
    check('assets_warranty_remind_from', sql`${table.warrantyRemindFromDays} between ${sql.raw(REMINDER_LEAD_RANGE)}`),
  ]
).enableRLS()

/**
 * A scanned or uploaded document. The file lives in the private `documents` Storage bucket and is
 * only ever reached through a short-lived signed URL made after this row has been authorized.
 * Sensitive documents are for owners and adults; the read policy says the same.
 */
export const documents = pgTable(
  'documents',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    kind: documentKind().notNull().default('other'),
    /** `<household id>/<random id>.<ext>` inside the bucket, from documentStoragePath. Never a URL. */
    storagePath: text().notNull(),
    mimeType: text().$type<DocumentMimeType>().notNull(),
    sizeBytes: integer().notNull(),
    issuedOn: date({ mode: 'string' }),
    expiresOn: date({ mode: 'string' }),
    /** Days before it expires that reminders start. Null for the default, from reminderLeadDays. */
    remindFromDays: smallint(),
    issuer: text(),
    referenceNumber: text(),
    /** The thing it's about. Removing the asset keeps the paperwork. */
    assetId: uuid().references(() => assets.id, { onDelete: 'set null' }),
    /** Whose it is: a passport's holder. Removing the person keeps the document. */
    personId: uuid().references(() => householdPeople.id, { onDelete: 'set null' }),
    notes: text(),
    uploadedBy: uuid().references(() => profiles.id, { onDelete: 'set null' }),
    isSensitive: boolean().notNull().default(false),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    unique('documents_storage_path_unique').on(table.storagePath),
    index('documents_household_created_idx').on(table.householdId, table.createdAt.desc()),
    index('documents_household_expires_idx')
      .on(table.householdId, table.expiresOn)
      .where(sql`${table.expiresOn} is not null`),
    index('documents_asset_idx')
      .on(table.assetId)
      .where(sql`${table.assetId} is not null`),
    index('documents_person_idx')
      .on(table.personId)
      .where(sql`${table.personId} is not null`),
    index('documents_uploaded_by_idx')
      .on(table.uploadedBy)
      .where(sql`${table.uploadedBy} is not null`),
    check('documents_title_length', sql`char_length(${table.title}) between 1 and ${sql.raw(String(DOCUMENT_TITLE_MAX_LENGTH))}`),
    check(
      'documents_text_lengths',
      sql`char_length(${table.issuer}) <= ${sql.raw(String(DOCUMENT_FIELD_MAX_LENGTH))}
        and char_length(${table.referenceNumber}) <= ${sql.raw(String(DOCUMENT_FIELD_MAX_LENGTH))}
        and char_length(${table.notes}) <= ${sql.raw(String(DOCUMENT_NOTES_MAX_LENGTH))}`
    ),
    check('documents_mime_type', inList(table.mimeType, DOCUMENT_MIME_TYPES)),
    check('documents_size', sql`${table.sizeBytes} between 1 and ${sql.raw(String(MAX_DOCUMENT_BYTES))}`),
    check('documents_remind_from', sql`${table.remindFromDays} between ${sql.raw(REMINDER_LEAD_RANGE)}`),
    // A row can only ever point at its own household's folder.
    check('documents_storage_path_household', sql`split_part(${table.storagePath}, '/', 1) = ${table.householdId}::text`),
    check('documents_expires_after_issued', sql`${table.expiresOn} >= ${table.issuedOn}`),
  ]
).enableRLS()

/**
 * A recurring or one-off job. `nextDueOn` is stored rather than derived so the dashboard and the
 * calendar can range over it; marking the job done rolls it forward. Deleting the asset deletes
 * its jobs and their history.
 */
export const maintenance = pgTable(
  'maintenance',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Null for a job about the house in general, like clearing the gutters. */
    assetId: uuid().references(() => assets.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    /** Null for a one-off job. */
    cadenceMonths: smallint(),
    /** Shown alongside the months. Ghar doesn't know the odometer, so it never sets a due date. */
    cadenceMiles: integer(),
    lastDoneOn: date({ mode: 'string' }),
    nextDueOn: date({ mode: 'string' }),
    assignedUserId: uuid().references(() => profiles.id, { onDelete: 'set null' }),
    instructions: text(),
    vendorContactId: uuid().references(() => contacts.id, { onDelete: 'set null' }),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    index('maintenance_household_due_idx').on(table.householdId, table.nextDueOn),
    index('maintenance_asset_idx')
      .on(table.assetId)
      .where(sql`${table.assetId} is not null`),
    index('maintenance_vendor_idx')
      .on(table.vendorContactId)
      .where(sql`${table.vendorContactId} is not null`),
    index('maintenance_assigned_user_idx')
      .on(table.assignedUserId)
      .where(sql`${table.assignedUserId} is not null`),
    check('maintenance_title_length', sql`char_length(${table.title}) between 1 and ${sql.raw(String(MAINTENANCE_TITLE_MAX_LENGTH))}`),
    check('maintenance_instructions_length', sql`char_length(${table.instructions}) <= ${sql.raw(String(HOME_NOTES_MAX_LENGTH))}`),
    check('maintenance_cadence_months', sql`${table.cadenceMonths} between 1 and ${sql.raw(String(MAX_CADENCE_MONTHS))}`),
    check('maintenance_cadence_miles', sql`${table.cadenceMiles} between 1 and ${sql.raw(String(MAX_CADENCE_MILES))}`),
  ]
).enableRLS()

/** Each time a job was done. The household comes from the job. */
export const maintenanceLog = pgTable(
  'maintenance_log',
  {
    id: uuid().primaryKey().defaultRandom(),
    maintenanceId: uuid()
      .notNull()
      .references(() => maintenance.id, { onDelete: 'cascade' }),
    completedOn: date({ mode: 'string' }).notNull(),
    completedBy: uuid().references(() => profiles.id, { onDelete: 'set null' }),
    costCents: cents(),
    notes: text(),
    /** The receipt or invoice. */
    documentId: uuid().references(() => documents.id, { onDelete: 'set null' }),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    index('maintenance_log_task_completed_idx').on(table.maintenanceId, table.completedOn.desc()),
    index('maintenance_log_completed_by_idx')
      .on(table.completedBy)
      .where(sql`${table.completedBy} is not null`),
    index('maintenance_log_document_idx')
      .on(table.documentId)
      .where(sql`${table.documentId} is not null`),
    check('maintenance_log_cost', sql`${table.costCents} between 0 and ${sql.raw(String(MAX_MAINTENANCE_COST_CENTS))}`),
    check('maintenance_log_notes_length', sql`char_length(${table.notes}) <= ${sql.raw(String(HOME_NOTES_MAX_LENGTH))}`),
  ]
).enableRLS()

/**
 * A bill that comes around on a schedule. Whether it's paid is worked out when it's read: the
 * matcher in @ghar/core/bills pairs due dates with transactions, and with the due dates someone
 * marked paid by hand in bill_payments.
 *
 * `dueMonth` anchors quarterly and annual bills (see BillSchedule). Monthly bills have none.
 */
export const bills = pgTable(
  'bills',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    /** Who is paid, as it shows up on a bank statement. The matcher reads this. */
    payee: text().notNull(),
    /** The usual amount. Null matches a payment of any size. */
    amountCents: cents(),
    isVariable: boolean().notNull().default(false),
    cadence: billCadence().notNull().default('monthly'),
    dueDay: smallint().notNull(),
    dueMonth: smallint(),
    autopay: boolean().notNull().default(false),
    /** The account it's paid from. When set, other accounts' transactions can't pay it. */
    accountId: uuid().references(() => accounts.id, { onDelete: 'set null' }),
    categoryId: uuid().references(() => categories.id, { onDelete: 'set null' }),
    url: text(),
    notes: text(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    index('bills_household_name_idx').on(table.householdId, sql`lower(${table.name})`, table.id),
    index('bills_account_idx')
      .on(table.accountId)
      .where(sql`${table.accountId} is not null`),
    index('bills_category_idx')
      .on(table.categoryId)
      .where(sql`${table.categoryId} is not null`),
    check('bills_name_length', sql`char_length(${table.name}) between 1 and ${sql.raw(String(BILL_NAME_MAX_LENGTH))}`),
    check('bills_payee_length', sql`char_length(${table.payee}) between 1 and ${sql.raw(String(BILL_PAYEE_MAX_LENGTH))}`),
    check(
      'bills_text_lengths',
      sql`char_length(${table.url}) <= ${sql.raw(String(URL_MAX_LENGTH))}
        and char_length(${table.notes}) <= ${sql.raw(String(BILL_NOTES_MAX_LENGTH))}`
    ),
    check('bills_amount', sql`${table.amountCents} between 1 and ${sql.raw(String(MAX_BILL_CENTS))}`),
    check('bills_due_day', sql`${table.dueDay} between 1 and 31`),
    check(
      'bills_due_month',
      sql`(${table.cadence} = 'monthly' and ${table.dueMonth} is null)
        or (${table.cadence} <> 'monthly' and ${table.dueMonth} between 1 and 12)`
    ),
  ]
).enableRLS()

/**
 * Something the household keeps current that isn't a paper Ghar holds, or not only one: a car's
 * registration, a license, a membership, a policy's term, a lease. `expiresOn` is where the current
 * term ends. One that renews on its own has that date moved on a term by the daily job once it
 * passes, so every reader can range over the stored date.
 *
 * Deleting the contact, asset or document it points at keeps the renewal.
 */
export const renewals = pgTable(
  'renewals',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    kind: renewalKind().notNull().default('other'),
    expiresOn: date({ mode: 'string' }).notNull(),
    /** Days before it runs out that reminders start. Null for the default, from reminderLeadDays. */
    remindFromDays: smallint(),
    /** Null when it doesn't renew on a schedule. */
    cadenceMonths: smallint(),
    autoRenews: boolean().notNull().default(false),
    costCents: cents(),
    provider: text(),
    referenceNumber: text(),
    url: text(),
    contactId: uuid().references(() => contacts.id, { onDelete: 'set null' }),
    assetId: uuid().references(() => assets.id, { onDelete: 'set null' }),
    /** The paper for the current term. */
    documentId: uuid().references(() => documents.id, { onDelete: 'set null' }),
    /** Whose it is: a driving licence's holder. */
    personId: uuid().references(() => householdPeople.id, { onDelete: 'set null' }),
    notes: text(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    index('renewals_household_expires_idx').on(table.householdId, table.expiresOn, table.id),
    index('renewals_contact_idx')
      .on(table.contactId)
      .where(sql`${table.contactId} is not null`),
    index('renewals_asset_idx')
      .on(table.assetId)
      .where(sql`${table.assetId} is not null`),
    index('renewals_document_idx')
      .on(table.documentId)
      .where(sql`${table.documentId} is not null`),
    index('renewals_person_idx')
      .on(table.personId)
      .where(sql`${table.personId} is not null`),
    check('renewals_title_length', sql`char_length(${table.title}) between 1 and ${sql.raw(String(RENEWAL_TITLE_MAX_LENGTH))}`),
    check(
      'renewals_text_lengths',
      sql`char_length(${table.provider}) <= ${sql.raw(String(RENEWAL_FIELD_MAX_LENGTH))}
        and char_length(${table.referenceNumber}) <= ${sql.raw(String(RENEWAL_FIELD_MAX_LENGTH))}
        and char_length(${table.url}) <= ${sql.raw(String(URL_MAX_LENGTH))}
        and char_length(${table.notes}) <= ${sql.raw(String(RENEWAL_NOTES_MAX_LENGTH))}`
    ),
    check('renewals_cadence', sql`${table.cadenceMonths} between 1 and ${sql.raw(String(MAX_RENEWAL_CADENCE_MONTHS))}`),
    check('renewals_cost', sql`${table.costCents} between 1 and ${sql.raw(String(MAX_RENEWAL_CENTS))}`),
    check('renewals_remind_from', sql`${table.remindFromDays} between ${sql.raw(REMINDER_LEAD_RANGE)}`),
    // Moving the date on by itself needs to know how far.
    check('renewals_auto_renews_cadence', sql`not ${table.autoRenews} or ${table.cadenceMonths} is not null`),
  ]
).enableRLS()

/**
 * An expiry reminder email that went out. The row is claimed before sending, so two runs on the
 * same day can't both send, and each tier goes once per expiry date: renewing a passport moves its
 * date and the reminders start over.
 *
 * No RLS policy: only the cron job reads it.
 */
export const expiryReminders = pgTable(
  'expiry_reminders',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    documentId: uuid().references(() => documents.id, { onDelete: 'cascade' }),
    /** For a warranty. */
    assetId: uuid().references(() => assets.id, { onDelete: 'cascade' }),
    renewalId: uuid().references(() => renewals.id, { onDelete: 'cascade' }),
    /** Days before the expiry: a lead time, or one of the follow-ups after it. See reminderTiers. */
    thresholdDays: smallint().notNull(),
    expiresOn: date({ mode: 'string' }).notNull(),
    sentAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    index('expiry_reminders_household_idx').on(table.householdId),
    uniqueIndex('expiry_reminders_document_unique')
      .on(table.documentId, table.thresholdDays, table.expiresOn)
      .where(sql`${table.documentId} is not null`),
    uniqueIndex('expiry_reminders_asset_unique')
      .on(table.assetId, table.thresholdDays, table.expiresOn)
      .where(sql`${table.assetId} is not null`),
    uniqueIndex('expiry_reminders_renewal_unique')
      .on(table.renewalId, table.thresholdDays, table.expiresOn)
      .where(sql`${table.renewalId} is not null`),
    check('expiry_reminders_one_subject', sql`num_nonnulls(${table.documentId}, ${table.assetId}, ${table.renewalId}) = 1`),
    check('expiry_reminders_threshold', sql`${table.thresholdDays} between ${sql.raw(REMINDER_LEAD_RANGE)}`),
  ]
).enableRLS()

/**
 * Someone said a thing that runs out won't be renewed. It holds for the one date: its reminders stop,
 * and it leaves the attention list and the digest. Renewing it, or editing the date, gives it a new
 * date this row doesn't cover, so it comes back.
 */
export const expiryDismissals = pgTable(
  'expiry_dismissals',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    documentId: uuid().references(() => documents.id, { onDelete: 'cascade' }),
    /** For a warranty. */
    assetId: uuid().references(() => assets.id, { onDelete: 'cascade' }),
    renewalId: uuid().references(() => renewals.id, { onDelete: 'cascade' }),
    expiresOn: date({ mode: 'string' }).notNull(),
    dismissedBy: uuid().references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    index('expiry_dismissals_household_idx').on(table.householdId),
    uniqueIndex('expiry_dismissals_document_unique')
      .on(table.documentId, table.expiresOn)
      .where(sql`${table.documentId} is not null`),
    uniqueIndex('expiry_dismissals_asset_unique')
      .on(table.assetId, table.expiresOn)
      .where(sql`${table.assetId} is not null`),
    uniqueIndex('expiry_dismissals_renewal_unique')
      .on(table.renewalId, table.expiresOn)
      .where(sql`${table.renewalId} is not null`),
    index('expiry_dismissals_dismissed_by_idx')
      .on(table.dismissedBy)
      .where(sql`${table.dismissedBy} is not null`),
    check('expiry_dismissals_one_subject', sql`num_nonnulls(${table.documentId}, ${table.assetId}, ${table.renewalId}) = 1`),
  ]
).enableRLS()

/**
 * A due date someone marked paid by hand, for a bill paid in a way no transaction shows: from an
 * account nobody linked, or from the digest's one-tap link. The matcher counts that due date paid.
 */
export const billPayments = pgTable(
  'bill_payments',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    billId: uuid()
      .notNull()
      .references(() => bills.id, { onDelete: 'cascade' }),
    dueOn: date({ mode: 'string' }).notNull(),
    paidOn: date({ mode: 'string' }).notNull(),
    markedBy: uuid().references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    unique('bill_payments_bill_due_unique').on(table.billId, table.dueOn),
    index('bill_payments_household_bill_due_idx').on(table.householdId, table.billId, table.dueOn),
    index('bill_payments_marked_by_idx')
      .on(table.markedBy)
      .where(sql`${table.markedBy} is not null`),
  ]
).enableRLS()

/**
 * One person's linked Gmail, read-only, searched daily for booking confirmations. OAuth is per
 * person, and the link belongs to the membership, so a member who leaves takes it with them.
 *
 * No RLS policy, so API roles cannot read it at all. It holds the refresh token.
 */
export const mailLinks = pgTable(
  'mail_links',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    /** The Google account it signed in as, shown so a person knows which inbox is linked. */
    accountEmail: text().notNull(),
    /** AES-256-GCM ciphertext from apps/web/lib/crypto.ts. Never select into a response. */
    refreshTokenEncrypted: text().notNull(),
    /** `needs_reconnect` after Google refuses the refresh token. Checks stop until then. */
    status: mailLinkStatus().notNull().default('active'),
    /** Why the last check failed, in our words. Never a vendor's response, never anything from a message. */
    lastError: text(),
    /** When the last complete check began. The next one searches from a little before it. */
    lastCheckedAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    unique('mail_links_user_unique').on(table.userId),
    index('mail_links_membership_idx').on(table.householdId, table.userId),
    foreignKey({
      name: 'mail_links_membership_fk',
      columns: [table.householdId, table.userId],
      foreignColumns: [householdMembers.householdId, householdMembers.userId],
    }).onDelete('cascade'),
    check('mail_links_last_error_length', sql`char_length(${table.lastError}) <= 500`),
  ]
).enableRLS()

/**
 * Every message a check listed and what became of it, so no message is read or sent to the model
 * twice. Keyed by the person and Gmail's message id, not the link, so linking the same inbox again
 * doesn't read it all over. Only the id is kept: nothing from the message itself.
 *
 * No RLS policy: only the mail check reads it.
 */
export const mailMessages = pgTable(
  'mail_messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    /** Gmail's id for the message. */
    messageId: text().notNull(),
    outcome: mailMessageOutcome().notNull(),
    /** How many checks have read it. A `failed` message is read again until MAIL_MAX_ATTEMPTS. */
    attempts: smallint().notNull().default(1),
    processedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    unique('mail_messages_user_message_unique').on(table.userId, table.messageId),
    index('mail_messages_membership_idx').on(table.householdId, table.userId),
    foreignKey({
      name: 'mail_messages_membership_fk',
      columns: [table.householdId, table.userId],
      foreignColumns: [householdMembers.householdId, householdMembers.userId],
    }).onDelete('cascade'),
    check('mail_messages_attempts', sql`${table.attempts} >= 1`),
  ]
).enableRLS()

/**
 * A booking the model read from a confirmation email, waiting for its person to confirm or correct
 * it. Nothing here is trusted: `rawExtract` is the model's answer, as checked against
 * bookingExtractSchema, and a booking exists only once someone saves the draft. The message's body
 * is never stored.
 *
 * Its person reads their own drafts: they came from their inbox.
 */
export const bookingDrafts = pgTable(
  'booking_drafts',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Whose inbox it came from. */
    userId: uuid()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    /** Gmail's id. The booking saved from it keeps it as `source_message_id`. */
    messageId: text().notNull(),
    receivedAt: timestamptz().notNull(),
    senderDomain: text().notNull(),
    /** Cut to MAIL_SUBJECT_MAX_LENGTH, so a person can find the email. */
    subject: text().notNull(),
    rawExtract: jsonb().$type<Record<string, unknown>>().notNull(),
    status: bookingDraftStatus().notNull().default('pending'),
    /** The booking saved from it. */
    bookingId: uuid().references(() => bookings.id, { onDelete: 'set null' }),
    reviewedAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    unique('booking_drafts_user_message_unique').on(table.userId, table.messageId),
    index('booking_drafts_membership_idx').on(table.householdId, table.userId),
    index('booking_drafts_booking_idx')
      .on(table.bookingId)
      .where(sql`${table.bookingId} is not null`),
    index('booking_drafts_pending_idx')
      .on(table.householdId, table.userId, table.receivedAt)
      .where(sql`${table.status} = 'pending'`),
    foreignKey({
      name: 'booking_drafts_membership_fk',
      columns: [table.householdId, table.userId],
      foreignColumns: [householdMembers.householdId, householdMembers.userId],
    }).onDelete('cascade'),
    check(
      'booking_drafts_text_lengths',
      sql`char_length(${table.subject}) <= ${sql.raw(String(MAIL_SUBJECT_MAX_LENGTH))}
        and char_length(${table.senderDomain}) <= 253`
    ),
    check('booking_drafts_reviewed', sql`(${table.status} = 'pending') = (${table.reviewedAt} is null)`),
    check('booking_drafts_confirmed_booking', sql`${table.status} = 'confirmed' or ${table.bookingId} is null`),
  ]
).enableRLS()

/**
 * How a person wants the daily digest: at all, which sections, and at what hour in the household's
 * zone. No row means DEFAULT_DIGEST_PREFERENCES. A section their role can't see is never sent,
 * whatever is stored here (see digestSectionsFor).
 */
export const digestPreferences = pgTable(
  'digest_preferences',
  {
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    enabled: boolean().notNull().default(true),
    /** Values from DIGEST_SECTIONS. */
    sections: text().array().$type<DigestSection[]>().notNull(),
    /** 0 to 23. */
    sendHour: smallint().notNull(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    primaryKey({ name: 'digest_preferences_pk', columns: [table.householdId, table.userId] }),
    index('digest_preferences_user_idx').on(table.userId),
    foreignKey({
      name: 'digest_preferences_membership_fk',
      columns: [table.householdId, table.userId],
      foreignColumns: [householdMembers.householdId, householdMembers.userId],
    }).onDelete('cascade'),
    check(
      'digest_preferences_sections',
      sql`${table.sections} <@ array[${sql.raw(DIGEST_SECTIONS.map(section => `'${section}'`).join(', '))}]::text[]`
    ),
    check('digest_preferences_send_hour', sql`${table.sendHour} between 0 and 23`),
  ]
).enableRLS()

/**
 * A digest that went out: one a person, a day, in the household's zone. Claimed before sending, so
 * hourly runs and retries can't send the same day's digest twice.
 *
 * No RLS policy: only the digest job reads it.
 */
export const digestSends = pgTable(
  'digest_sends',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    /** The household's day the digest is for. */
    digestOn: date({ mode: 'string' }).notNull(),
    sentAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    unique('digest_sends_user_day_unique').on(table.householdId, table.userId, table.digestOn),
    index('digest_sends_user_idx').on(table.userId),
    foreignKey({
      name: 'digest_sends_membership_fk',
      columns: [table.householdId, table.userId],
      foreignColumns: [householdMembers.householdId, householdMembers.userId],
    }).onDelete('cascade'),
  ]
).enableRLS()

/**
 * A one-tap link from an email: one action, on one thing, for the person it was sent to, used at most
 * once before it expires. The link carries this row's id and an HMAC over what it may do
 * (apps/web/lib/one-tap.ts); the row is what makes it single-use. Using it acts as that person with
 * the role they hold then, so a link sent before they lost access does nothing. Leaving the household
 * deletes their links.
 *
 * No RLS policy: only the server reads it.
 */
export const actionTokens = pgTable(
  'action_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    action: oneTapAction().notNull(),
    /** The transaction, bill, document, asset or renewal. Not a foreign key: once it's deleted, the link finds nothing. */
    entityId: uuid().notNull(),
    /** For `mark_bill_paid`, the due date it marks paid; for a "not renewing" link, the expiry date. */
    dueOn: date({ mode: 'string' }),
    expiresAt: timestamptz().notNull(),
    usedAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    index('action_tokens_membership_idx').on(table.householdId, table.userId),
    index('action_tokens_user_idx').on(table.userId),
    index('action_tokens_expires_idx').on(table.expiresAt),
    foreignKey({
      name: 'action_tokens_membership_fk',
      columns: [table.householdId, table.userId],
      foreignColumns: [householdMembers.householdId, householdMembers.userId],
    }).onDelete('cascade'),
    check('action_tokens_expiry', sql`${table.expiresAt} > ${table.createdAt}`),
    // Compared as text: a value added to the enum can't be named as one in the migration that adds it.
    check(
      'action_tokens_due_on',
      sql`(${table.action}::text in (${sql.raw(ONE_TAP_ACTIONS.filter(oneTapActionHasDate).map(action => `'${action}'`).join(', '))})) = (${table.dueOn} is not null)`
    ),
  ]
).enableRLS()

/**
 * A row deleted from a table `GET /api/v1/sync` sends, so a phone holding it knows to drop it. Written
 * only by the delete triggers in migration 0008, never by app code. A row deleted because its household
 * or its trip went is not recorded: the client removes children along with their parent.
 *
 * Nothing prunes these yet; see docs/architecture.md.
 *
 * No RLS policy: only the sync endpoint reads it.
 */
export const syncTombstones = pgTable(
  'sync_tombstones',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /**
     * For something only one person sees (a booking draft, digest preferences): whose it was. Not a
     * foreign key, so a person being deleted can still leave rows.
     */
    userId: uuid(),
    entity: text().$type<SyncEntity>().notNull(),
    /** The deleted row's id. For a member or digest preferences, the person's user id. */
    entityId: uuid().notNull(),
    deletedAt: timestamptz()
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  table => [
    index('sync_tombstones_household_deleted_idx').on(table.householdId, table.deletedAt, table.id),
    check('sync_tombstones_entity', inList(table.entity, SYNC_ENTITIES)),
  ]
).enableRLS()

/**
 * An access and refresh token pair for an API client that can't hold a session cookie (the phone app).
 * Only SHA-256 hashes are stored; the tokens themselves are shown once, when issued. Refreshing rotates
 * the pair: the old row gets `rotatedAt`, and presenting its refresh token again revokes every row in
 * the family, since it means a token was copied. Signing out revokes the family too.
 *
 * `householdId` is the household the pair acts in, checked against current membership on every request.
 * Leaving the household deletes the pairs scoped to it.
 *
 * No RLS policy: it holds token hashes, and only the server reads it.
 */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Every pair descended from one sign-in by refreshing. */
    familyId: uuid().notNull(),
    userId: uuid()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    /** Null until the person has a household: onboarding runs on a token too. */
    householdId: uuid().references(() => households.id, { onDelete: 'cascade' }),
    accessTokenHash: text().notNull(),
    refreshTokenHash: text().notNull(),
    accessExpiresAt: timestamptz().notNull(),
    refreshExpiresAt: timestamptz().notNull(),
    rotatedAt: timestamptz(),
    revokedAt: timestamptz(),
    lastUsedAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  table => [
    unique('api_tokens_access_token_hash_unique').on(table.accessTokenHash),
    unique('api_tokens_refresh_token_hash_unique').on(table.refreshTokenHash),
    index('api_tokens_family_idx').on(table.familyId),
    index('api_tokens_user_idx').on(table.userId),
    index('api_tokens_membership_idx')
      .on(table.householdId, table.userId)
      .where(sql`${table.householdId} is not null`),
    foreignKey({
      name: 'api_tokens_membership_fk',
      columns: [table.householdId, table.userId],
      foreignColumns: [householdMembers.householdId, householdMembers.userId],
    }).onDelete('cascade'),
    check(
      'api_tokens_expiry',
      sql`${table.accessExpiresAt} > ${table.createdAt} and ${table.refreshExpiresAt} >= ${table.accessExpiresAt}`
    ),
  ]
).enableRLS()
