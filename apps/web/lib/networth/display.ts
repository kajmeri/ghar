import type { Debt, ManualAccountKindValue, NetWorthRangeValue } from '@ghar/contracts'
import {
  DEFAULT_NETWORTH_RANGE,
  isLiabilityKind,
  isNetWorthRange,
  MANUAL_ACCOUNT_KIND_LABELS,
  MANUAL_ACCOUNT_KINDS,
} from '@ghar/core/finances'

// Labels and URL shapes for the net worth pages. Every figure is already signed and shaped by
// @ghar/core/finances; these only name things.

export const NET_WORTH_PATH = '/finances/net-worth'

/** The line over stacked areas, or assets and debts as two lines from zero. */
export type NetWorthView = 'net' | 'split'

export const RANGE_OPTIONS: { value: NetWorthRangeValue; label: string; name: string }[] = [
  { value: '6M', label: '6M', name: 'Six months' },
  { value: '1Y', label: '1Y', name: 'One year' },
  { value: 'ALL', label: 'All', name: 'All time' },
]

export const VIEW_OPTIONS: { value: NetWorthView; label: string }[] = [
  { value: 'net', label: 'Net worth' },
  { value: 'split', label: 'Own vs owe' },
]

export function parseRange(value: string | string[] | undefined): NetWorthRangeValue {
  return typeof value === 'string' && isNetWorthRange(value) ? value : DEFAULT_NETWORTH_RANGE
}

export function parseView(value: string | string[] | undefined): NetWorthView {
  return value === 'split' ? 'split' : 'net'
}

/** Leaves defaults out, so the plain page is the 1Y net worth view. */
export function netWorthHref({ range, view }: { range: NetWorthRangeValue; view: NetWorthView }): string {
  const params = new URLSearchParams()
  if (range !== DEFAULT_NETWORTH_RANGE) params.set('range', range)
  if (view !== 'net') params.set('view', view)
  const query = params.toString()
  return query ? `${NET_WORTH_PATH}?${query}` : NET_WORTH_PATH
}

export function manualAccountHref(manualAccountId: string): string {
  return `${NET_WORTH_PATH}/manual/${manualAccountId}`
}

export const DEBT_KIND_LABELS: Record<Debt['kind'], string> = {
  credit: 'Credit card',
  student: 'Student loan',
  mortgage: 'Mortgage',
  other: 'Loan',
}

export const MANUAL_KIND_GROUPS: { label: string; kinds: { value: ManualAccountKindValue; label: string }[] }[] = [
  { label: 'Something you own', kinds: kindsWhere(kind => !isLiabilityKind(kind)) },
  { label: 'Money you owe', kinds: kindsWhere(kind => isLiabilityKind(kind)) },
]

function kindsWhere(keep: (kind: ManualAccountKindValue) => boolean) {
  return MANUAL_ACCOUNT_KINDS.filter(keep).map(kind => ({ value: kind, label: MANUAL_ACCOUNT_KIND_LABELS[kind] }))
}

export const REMINDER_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'Never' },
  { value: 1, label: 'Every month' },
  { value: 3, label: 'Every 3 months' },
  { value: 6, label: 'Every 6 months' },
  { value: 12, label: 'Every year' },
]

const aprFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

export function formatApr(aprPercent: number): string {
  return `${aprFormat.format(aprPercent)}%`
}

/** Net worth rising is good news; there's no reading where it isn't. */
export function sentimentOf(cents: number): 'positive' | 'negative' | 'neutral' {
  return cents > 0 ? 'positive' : cents < 0 ? 'negative' : 'neutral'
}
