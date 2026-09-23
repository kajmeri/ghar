// How every money page says a share and a change. Figures arrive already signed and worked out by
// @ghar/core; nothing here decides anything, it only puts words to a number.

const shareFormat = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 })
const percentFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, signDisplay: 'exceptZero' })

/** A 0 to 1 share as "42%". A sliver shows as "<1%" rather than a misleading zero. */
export function formatShare(share: number): string {
  if (share > 0 && share < 0.005) return '<1%'
  return shareFormat.format(share)
}

/** A percent change, already times 100, as "+2.1%". */
export function formatPercentChange(percent: number): string {
  return `${percentFormat.format(percent)}%`
}

export type Direction = 'up' | 'down' | 'flat'

export function directionOf(cents: number): Direction {
  return cents > 0 ? 'up' : cents < 0 ? 'down' : 'flat'
}
