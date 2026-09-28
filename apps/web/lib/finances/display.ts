import type { CategoryMatcherTypeValue, CategoryRule, CategorySourceValue, TrendRangeValue } from '@ghar/contracts'
import { formatCalendarDate, isCalendarDate, type CalendarDate } from '@ghar/core/dates'
import { daysInPeriod, DEFAULT_TREND_RANGE, isMonthStart, isTrendRange, parseAmountRange } from '@ghar/core/finances'
import { formatCents } from '@ghar/core/money'

// Names and URL shapes for the money pages. Nothing here decides anything: the figures are already
// signed and shaped by @ghar/core, and what a charge is filed under comes from the server.

export const TRANSACTIONS_PATH = '/finances/transactions'
export const BUDGET_PATH = '/finances/budget'
export const GOALS_PATH = '/finances/goals'
export const CATEGORIES_PATH = '/finances/categories'
export const RULES_PATH = '/finances/rules'
export const TRENDS_PATH = '/finances/trends'

export const TREND_RANGE_OPTIONS: { value: TrendRangeValue; label: string; name: string }[] = [
  { value: '6M', label: '6M', name: 'Six months' },
  { value: '12M', label: '12M', name: 'Twelve months' },
]

/** The range the trends page was asked for, or six months. */
export function parseTrendRange(value: string | string[] | undefined): TrendRangeValue {
  return typeof value === 'string' && isTrendRange(value) ? value : DEFAULT_TREND_RANGE
}

/** Leaves the default out, so the plain page is six months. */
export function trendsHref(range: TrendRangeValue = DEFAULT_TREND_RANGE): string {
  return range === DEFAULT_TREND_RANGE ? TRENDS_PATH : `${TRENDS_PATH}?range=${range}`
}

/** One month's plan. Without a month, the one the household is in. */
export function budgetHref(periodStart?: string): string {
  return periodStart ? `${BUDGET_PATH}?month=${periodStart}` : BUDGET_PATH
}

/** The month a budget page was asked for, or undefined so the server picks the household's own. */
export function budgetMonthParam(value: string | string[] | undefined): string | undefined {
  const month = first(value)
  return isMonthStart(month) ? month : undefined
}

/**
 * The days a month's links cover: the whole month, or as much of it as has happened, so a figure
 * for the month so far and the list behind it are about the same days.
 */
export function monthRange(periodStart: CalendarDate, today: CalendarDate): { from: string; to: string } {
  const lastDay = `${periodStart.slice(0, 7)}-${String(daysInPeriod(periodStart)).padStart(2, '0')}`
  return { from: periodStart, to: today >= periodStart && today < lastDay ? today : lastDay }
}

/** Who decided a category, said plainly, for the line under a charge. */
export const CATEGORY_SOURCE_LABELS: Record<CategorySourceValue, string> = {
  user: 'Filed by you',
  rule: 'Filed by a rule',
  pfc: 'From your bank',
  llm: 'Filed by Ghar',
}

/** The value the category filter takes for charges nobody has filed. */
export const UNFILED = 'none'

/** The filters the transactions list reads from the URL. */
export interface TransactionFilterParams {
  q: string
  account: string
  category: string
  review: boolean
  /** A closed date range, both ends included. The Money screen's links set it to a month. */
  from: string
  to: string
}

/**
 * The filters as the list endpoint's query, leaving out the ones that aren't set. The first page and
 * every "Show more" after it use this, so a later page asks the same question its cursor was made for.
 */
export function transactionsQuery(filters: TransactionFilterParams): {
  q?: string
  accountId?: string
  categoryId?: string
  review?: true
  from?: string
  to?: string
} {
  return {
    q: filters.q === '' ? undefined : filters.q,
    accountId: filters.account === '' ? undefined : filters.account,
    categoryId: filters.category === '' ? undefined : filters.category,
    review: filters.review ? true : undefined,
    from: filters.from === '' ? undefined : filters.from,
    to: filters.to === '' ? undefined : filters.to,
  }
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ''
}

export function transactionFilters(params: Record<string, string | string[] | undefined>): TransactionFilterParams {
  return {
    q: first(params.q),
    account: first(params.account),
    category: first(params.category),
    review: first(params.review) === '1',
    from: calendarDate(first(params.from)),
    to: calendarDate(first(params.to)),
  }
}

/** A range only counts if both ends are real dates, so a hand-edited URL can't narrow the list oddly. */
function calendarDate(value: string): string {
  return isCalendarDate(value) ? value : ''
}

/** The same filters as a query string, for a link that changes one of them. */
export function transactionsHref(filters: Partial<TransactionFilterParams>): string {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.account) params.set('account', filters.account)
  if (filters.category) params.set('category', filters.category)
  if (filters.review) params.set('review', '1')
  if (filters.from && filters.to) {
    params.set('from', filters.from)
    params.set('to', filters.to)
  }
  const query = params.toString()
  return query === '' ? TRANSACTIONS_PATH : `${TRANSACTIONS_PATH}?${query}`
}

/** What the range chip above the list says: "September 2026" for a whole month, else two dates. */
export function rangeLabel(filters: Pick<TransactionFilterParams, 'from' | 'to'>): string | null {
  if (!filters.from || !filters.to) return null
  const wholeMonth = filters.from.endsWith('-01') && filters.to.slice(0, 7) === filters.from.slice(0, 7)
  return wholeMonth
    ? formatCalendarDate(filters.from, 'MMMM yyyy')
    : `${formatCalendarDate(filters.from)} to ${formatCalendarDate(filters.to)}`
}

/** What a rule kind is called where someone picks one. */
export const MATCHER_TYPE_LABELS: Record<CategoryMatcherTypeValue, string> = {
  merchant_exact: 'The merchant, exactly',
  merchant_contains: 'The merchant or description contains',
  name_regex: 'The description matches a pattern',
  amount_range: 'The amount falls in a range',
}

/** What to type in for each kind of rule. */
export const MATCHER_TYPE_HINTS: Record<CategoryMatcherTypeValue, string> = {
  merchant_exact: 'The whole merchant name, as the charge shows it. Capitals don’t matter.',
  merchant_contains: 'A word or two that appears in the charge, such as uber.',
  name_regex: 'A regular expression, such as ^AMZN.',
  amount_range: 'Two amounts in cents, either end open: -5000..-1000 is $10 to $50 out.',
}

/** One end of an amount rule, as money. */
function rangeEnd(cents: number, currency: string): string {
  return formatCents(cents, { currency })
}

/**
 * A rule in a sentence, the way the screen says it: "Anything from trader joe's", not a matcher
 * type and a string. An amount range reads as money, in the household's own currency.
 */
export function ruleSentence(rule: Pick<CategoryRule, 'matcherType' | 'matcherValue'>, currency: string): string {
  switch (rule.matcherType) {
    case 'merchant_exact':
      return `Anything from ${rule.matcherValue}`
    case 'merchant_contains':
      return `Anything with ${rule.matcherValue} in it`
    case 'name_regex':
      return `Descriptions matching ${rule.matcherValue}`
    case 'amount_range': {
      const range = parseAmountRange(rule.matcherValue)
      if (range === null) return `Amounts in ${rule.matcherValue}`
      if (range.minCents === null) return `Anything up to ${rangeEnd(range.maxCents ?? 0, currency)}`
      if (range.maxCents === null) return `Anything from ${rangeEnd(range.minCents, currency)} up`
      return `Anything from ${rangeEnd(range.minCents, currency)} to ${rangeEnd(range.maxCents, currency)}`
    }
  }
}

/** How many charges a rule has filed, said plainly. */
export function ruleHits(hitCount: number): string {
  if (hitCount === 0) return 'Nothing filed yet'
  return hitCount === 1 ? 'Filed one charge' : `Filed ${String(hitCount)} charges`
}
