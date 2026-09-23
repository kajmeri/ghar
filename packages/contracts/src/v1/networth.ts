import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { calendarDateSchema, centsSchema, instantSchema, pageQuerySchema, pageSchema, queryBooleanSchema } from './shared'

// Net worth: what the household owns less what it owes, day by day. Owners and adults only.
//
// Every balance here is signed the way it counts toward net worth: positive for what's owned,
// negative for what's owed. The server applies the sign when it takes the daily snapshot, so a
// client never looks at an account's type to decide it. Chart points, domains and ticks come
// ready to draw.

// ---------------------------------------------------------------------------------------------
// Manual accounts

/** Mirrors MANUAL_ACCOUNT_KINDS in @ghar/core/finances. Loans and other liabilities are owed. */
export const manualAccountKindSchema = z.enum([
  'property',
  'vehicle',
  'retirement',
  'crypto',
  'cash',
  'other_asset',
  'loan',
  'other_liability',
])
export type ManualAccountKindValue = z.infer<typeof manualAccountKindSchema>

/** Mirrors MANUAL_VALUE_SOURCES in @ghar/core/finances. */
export const manualValueSourceSchema = z.enum(['manual', 'estimate'])

/** Mirrors MAX_MANUAL_VALUE_CENTS in @ghar/core/finances: a billion dollars. */
const MAX_MANUAL_VALUE_CENTS = 100_000_000_000

export const manualAccountSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: manualAccountKindSchema,
  /** Follows from the kind. */
  isLiability: z.boolean(),
  notes: z.string().nullable(),
  /** Months after the newest value before the digest asks for a new one. Null for never. */
  reminderCadenceMonths: z.int().nullable(),
  /** Left out of today's net worth and the reminders. Its history stays. */
  archivedAt: instantSchema.nullable(),
  /** The newest value, unsigned: for a loan, what's still owed. Null before the first. */
  latestValue: z
    .object({
      asOf: calendarDateSchema,
      valueCents: centsSchema,
      source: manualValueSourceSchema,
    })
    .nullable(),
  createdAt: instantSchema,
  /** Moves when a value is added or removed, too. */
  updatedAt: instantSchema,
})
export type ManualAccount = z.infer<typeof manualAccountSchema>

/** One value as of a date. Updating an estimate adds one; the newest on or before a day counts. */
export const manualValueSchema = z.object({
  id: z.uuid(),
  manualAccountId: z.uuid(),
  asOf: calendarDateSchema,
  /** Never negative. The account's kind says whether it's owned or owed. */
  valueCents: centsSchema,
  source: manualValueSourceSchema,
  notes: z.string().nullable(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
})
export type ManualValue = z.infer<typeof manualValueSchema>

export const manualAccountParamsSchema = z.object({ manualAccountId: z.uuid() })
export const manualValueParamsSchema = manualAccountParamsSchema.extend({ valueId: z.uuid() })

export const manualValueBodySchema = z.object({
  /** Today or earlier, in the household's time zone. */
  asOf: calendarDateSchema,
  valueCents: z.int().min(0).max(MAX_MANUAL_VALUE_CENTS),
  source: manualValueSourceSchema.default('manual'),
  notes: z.string().trim().max(500).nullable().default(null),
})
export type ManualValueBody = z.output<typeof manualValueBodySchema>

const manualAccountFieldsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: manualAccountKindSchema,
  notes: z.string().trim().max(500).nullable().default(null),
  reminderCadenceMonths: z.int().min(1).max(24).nullable().default(null),
})

export const createManualAccountBodySchema = manualAccountFieldsSchema.extend({
  /** The first value, saved with the account. */
  value: manualValueBodySchema.nullable().default(null),
})
export type CreateManualAccountBody = z.output<typeof createManualAccountBodySchema>

/** Replaces every field. Changing the kind leaves past snapshots signed as they were taken. */
export const updateManualAccountBodySchema = manualAccountFieldsSchema.extend({
  archived: z.boolean().default(false),
})
export type UpdateManualAccountBody = z.output<typeof updateManualAccountBodySchema>

/** By name, ignoring case. Archived accounts only when asked for. */
export const listManualAccounts = defineEndpoint({
  method: 'GET',
  path: '/api/v1/manual-accounts',
  query: pageQuerySchema.extend({ includeArchived: queryBooleanSchema.default(false) }),
  response: pageSchema(manualAccountSchema),
})

export const getManualAccount = defineEndpoint({
  method: 'GET',
  path: '/api/v1/manual-accounts/:manualAccountId',
  params: manualAccountParamsSchema,
  response: z.object({ account: manualAccountSchema }),
})

export const createManualAccount = defineEndpoint({
  method: 'POST',
  path: '/api/v1/manual-accounts',
  body: createManualAccountBodySchema,
  response: z.object({ account: manualAccountSchema }),
})

export const updateManualAccount = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/manual-accounts/:manualAccountId',
  params: manualAccountParamsSchema,
  body: updateManualAccountBodySchema,
  response: z.object({ account: manualAccountSchema }),
})

/** Takes its values and its snapshots with it, so past net worth days lose it too. Archive to keep them. */
export const deleteManualAccount = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/manual-accounts/:manualAccountId',
  params: manualAccountParamsSchema,
  response: z.object({ manualAccountId: z.uuid() }),
})

/** Newest first. */
export const listManualValues = defineEndpoint({
  method: 'GET',
  path: '/api/v1/manual-accounts/:manualAccountId/values',
  params: manualAccountParamsSchema,
  query: pageQuerySchema,
  response: pageSchema(manualValueSchema),
})

/** Adds a value. Earlier values stay as history. */
export const addManualValue = defineEndpoint({
  method: 'POST',
  path: '/api/v1/manual-accounts/:manualAccountId/values',
  params: manualAccountParamsSchema,
  body: manualValueBodySchema,
  response: z.object({ value: manualValueSchema, account: manualAccountSchema }),
})

/** For a value entered by mistake. Snapshots already taken keep what they recorded. */
export const deleteManualValue = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/manual-accounts/:manualAccountId/values/:valueId',
  params: manualValueParamsSchema,
  response: z.object({ valueId: z.uuid(), account: manualAccountSchema }),
})

// ---------------------------------------------------------------------------------------------
// The overview

/** Mirrors NETWORTH_RANGES in @ghar/core/finances. A year by default: short windows are market noise. */
export const netWorthRangeSchema = z.enum(['6M', '1Y', 'ALL'])
export type NetWorthRangeValue = z.infer<typeof netWorthRangeSchema>

export const netWorthTotalsSchema = z.object({
  asOf: calendarDateSchema,
  assetsCents: centsSchema,
  /** Signed, zero or below. netCents = assetsCents + liabilitiesCents. */
  liabilitiesCents: centsSchema,
  netCents: centsSchema,
  accountCount: z.int(),
  /** Accounts whose balance was carried forward that day because the bank couldn't be reached. */
  staleAccountCount: z.int(),
})
export type NetWorthTotals = z.infer<typeof netWorthTotalsSchema>

export const netWorthDeltaSchema = z.object({
  fromOn: calendarDateSchema,
  toOn: calendarDateSchema,
  cents: centsSchema,
  /** Of the starting value's size. Null from a start of zero. */
  percent: z.number().nullable(),
  /** Either end carried an account forward. */
  includesStale: z.boolean(),
})
export type NetWorthDeltaValue = z.infer<typeof netWorthDeltaSchema>

export const chartDomainSchema = z.object({
  minCents: centsSchema,
  maxCents: centsSchema,
  ticks: z.array(centsSchema),
})

export const netWorthChartPointSchema = z.object({
  asOf: calendarDateSchema,
  netCents: centsSchema,
  assetsCents: centsSchema,
  /** Signed, for the stacked area below zero. */
  liabilitiesCents: centsSchema,
  /** The same debt as a positive amount, for the assets-versus-liabilities view. */
  owedCents: centsSchema,
  /** An account in this reading, or any day of its week or month, was carried forward. */
  stale: z.boolean(),
  /** Typed in from old records. */
  manual: z.boolean(),
})

export const netWorthChartSchema = z.object({
  range: netWorthRangeSchema,
  /** How far apart the points are. Each is the last reading of its period, never an average. */
  granularity: z.enum(['day', 'week', 'month']),
  /** empty: nothing yet. starting: under a week of readings; show the number, not a line. ready: draw it. */
  status: z.enum(['empty', 'starting', 'ready']),
  points: z.array(netWorthChartPointSchema),
  staleRanges: z.array(z.object({ fromOn: calendarDateSchema, toOn: calendarDateSchema })),
  /** For the net worth line over stacked assets and liabilities. */
  netDomain: chartDomainSchema,
  /** For assets and amounts owed side by side, both from zero. */
  splitDomain: chartDomainSchema,
  xTicks: z.array(calendarDateSchema),
  historyStartsOn: calendarDateSchema.nullable(),
  /** The first measured day. Nothing before it can be fetched from the banks. */
  trackingStartedOn: calendarDateSchema.nullable(),
})
export type NetWorthChartValue = z.infer<typeof netWorthChartSchema>

export const netWorthAccountSchema = z.object({
  /** An account id or a manual account id, depending on the source. */
  id: z.uuid(),
  name: z.string(),
  source: z.enum(['plaid', 'manual']),
  /** Plaid's account type, or a manual account's kind. For display only: the sign is already applied. */
  type: z.string(),
  /** A label for the type: "Credit card", "Property". */
  typeLabel: z.string(),
  /** Signed, from the latest snapshot. */
  balanceCents: centsSchema,
  /** Of its group's total, 0 to 1. */
  share: z.number(),
  isStale: z.boolean(),
  /** A manual account's newest value date, or the day a bank balance last refreshed. */
  updatedOn: calendarDateSchema.nullable(),
  institutionName: z.string().nullable(),
  mask: z.string().nullable(),
})
export type NetWorthAccountValue = z.infer<typeof netWorthAccountSchema>

export const netWorthAccountGroupSchema = z.object({
  /** Signed. */
  totalCents: centsSchema,
  accounts: z.array(netWorthAccountSchema),
})

export const netWorthResponseSchema = z.object({
  /** The newest snapshot. Null until the first one is taken. */
  latest: netWorthTotalsSchema.nullable(),
  deltas: z.object({
    month: netWorthDeltaSchema.nullable(),
    year: netWorthDeltaSchema.nullable(),
    allTime: netWorthDeltaSchema.nullable(),
  }),
  chart: netWorthChartSchema,
  /** From the latest snapshot's day. */
  assets: netWorthAccountGroupSchema,
  liabilities: netWorthAccountGroupSchema,
})
export type NetWorthResponse = z.infer<typeof netWorthResponseSchema>

export const getNetWorth = defineEndpoint({
  method: 'GET',
  path: '/api/v1/net-worth',
  query: z.object({ range: netWorthRangeSchema.default('1Y') }),
  response: netWorthResponseSchema,
})

// ---------------------------------------------------------------------------------------------
// Investments

export const allocationSliceSchema = z.object({
  key: z.string(),
  label: z.string(),
  valueCents: centsSchema,
  /** Of all holdings, 0 to 1. */
  share: z.number(),
})

export const holdingSliceSchema = allocationSliceSchema.extend({
  ticker: z.string().nullable(),
  securityType: z.string().nullable(),
  /** Null unless every position under the ticker reports a cost basis. */
  costBasisCents: centsSchema.nullable(),
  gainCents: centsSchema.nullable(),
  gainPercent: z.number().nullable(),
})

export const investmentAccountSchema = z.object({
  accountId: z.uuid(),
  name: z.string(),
  institutionName: z.string().nullable(),
  mask: z.string().nullable(),
  /** The account's balance: its value in net worth. */
  balanceCents: centsSchema.nullable(),
  /** What its holdings add up to. Shown for comparison, never counted in net worth. */
  holdingsValueCents: centsSchema,
  holdingsAsOf: calendarDateSchema.nullable(),
  /**
   * The last year's change split into money moved in (from transfers the household's own
   * transactions flagged) and the rest. An approximation. marketCents is null when an end is stale.
   */
  change: z
    .object({
      fromOn: calendarDateSchema,
      toOn: calendarDateSchema,
      changeCents: centsSchema,
      contributionsCents: centsSchema,
      marketCents: centsSchema.nullable(),
    })
    .nullable(),
})

export const netWorthCompositionResponseSchema = z.object({
  /** Holdings across every investment account. Composition only: shares of what's invested. */
  totalCents: centsSchema,
  byType: z.array(allocationSliceSchema),
  /** Largest first. */
  byTicker: z.array(holdingSliceSchema),
  /** Over holdings with a cost basis. Null when none has one. */
  gain: z
    .object({
      valueCents: centsSchema,
      costBasisCents: centsSchema,
      gainCents: centsSchema,
      percent: z.number().nullable(),
      coveredShare: z.number(),
    })
    .nullable(),
  accounts: z.array(investmentAccountSchema),
})
export type NetWorthComposition = z.infer<typeof netWorthCompositionResponseSchema>

export const getNetWorthComposition = defineEndpoint({
  method: 'GET',
  path: '/api/v1/net-worth/composition',
  response: netWorthCompositionResponseSchema,
})

// ---------------------------------------------------------------------------------------------
// Debts

/** Mirrors LIABILITY_KINDS in @ghar/core/finances, plus other for a loan Plaid gave no detail for. */
export const debtKindSchema = z.enum(['credit', 'student', 'mortgage', 'other'])

export const debtSchema = z.object({
  /** An account id or a manual account id, depending on the source. */
  id: z.uuid(),
  source: z.enum(['plaid', 'manual']),
  name: z.string(),
  institutionName: z.string().nullable(),
  mask: z.string().nullable(),
  kind: debtKindSchema,
  /** Signed, zero or below. */
  balanceCents: centsSchema,
  /** A card's purchase APR or a loan's rate, as a percent. Null when the lender doesn't say. */
  aprPercent: z.number().nullable(),
  minimumPaymentCents: centsSchema.nullable(),
  nextPaymentDueOn: calendarDateSchema.nullable(),
  isOverdue: z.boolean(),
  lastPaymentCents: centsSchema.nullable(),
  lastPaymentOn: calendarDateSchema.nullable(),
  originationDate: calendarDateSchema.nullable(),
  originalPrincipalCents: centsSchema.nullable(),
})
export type Debt = z.infer<typeof debtSchema>

/** Highest APR first, the order to pay down in. Debts with no APR last, larger balances first. */
export const listDebts = defineEndpoint({
  method: 'GET',
  path: '/api/v1/net-worth/debts',
  response: z.object({ debts: z.array(debtSchema) }),
})

// ---------------------------------------------------------------------------------------------
// History typed in from old records

export const netWorthHistoryEntrySchema = z.object({
  id: z.uuid(),
  asOf: calendarDateSchema,
  assetsCents: centsSchema,
  /** What was owed, positive. */
  owedCents: centsSchema,
  netCents: centsSchema,
  createdAt: instantSchema,
  updatedAt: instantSchema,
})
export type NetWorthHistoryEntry = z.infer<typeof netWorthHistoryEntrySchema>

/** Mirrors validateHistoricalSnapshot's cap in @ghar/core/finances. */
const MAX_HISTORY_CENTS = MAX_MANUAL_VALUE_CENTS * 10

export const netWorthHistoryBodySchema = z.object({
  /** Before the first measured day. Later days are already recorded. */
  asOf: calendarDateSchema,
  assetsCents: z.int().min(0).max(MAX_HISTORY_CENTS),
  /** As a statement shows it: positive. */
  owedCents: z.int().min(0).max(MAX_HISTORY_CENTS),
})
export type NetWorthHistoryBody = z.output<typeof netWorthHistoryBodySchema>

export const netWorthHistoryParamsSchema = z.object({ entryId: z.uuid() })

/** Typed-in days only, newest first. */
export const listNetWorthHistory = defineEndpoint({
  method: 'GET',
  path: '/api/v1/net-worth/history',
  query: pageQuerySchema,
  response: pageSchema(netWorthHistoryEntrySchema),
})

/** Sets the figure for a day, replacing one typed in for the same day. */
export const saveNetWorthHistory = defineEndpoint({
  method: 'POST',
  path: '/api/v1/net-worth/history',
  body: netWorthHistoryBodySchema,
  response: z.object({ entry: netWorthHistoryEntrySchema }),
})

export const deleteNetWorthHistory = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/net-worth/history/:entryId',
  params: netWorthHistoryParamsSchema,
  response: z.object({ entryId: z.uuid() }),
})
