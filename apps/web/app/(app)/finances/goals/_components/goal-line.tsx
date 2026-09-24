import type { GoalHistoryValue } from '@ghar/contracts'
import { daysBetween, formatCalendarDate } from '@ghar/core/dates'
import { formatCents } from '@ghar/core/money'

/**
 * A goal's saved money over the last few months, up towards a dashed line for the target, and
 * what the recent rate says about getting there. Every figure is @ghar/core's; this only draws it.
 */
export function GoalLine({ history, targetCents, reached, currency }: GoalLineProps) {
  const first = history.points[0]
  const last = history.points.at(-1)
  if (!first || !last || first.asOf === last.asOf) return null

  const money = (cents: number) => formatCents(cents, { currency })
  const days = daysBetween(first.asOf, last.asOf)
  const x = (asOf: string) => (daysBetween(first.asOf, asOf) / days) * 100
  const y = (cents: number) => (1 - cents / (history.maxCents || 1)) * 100
  const line = history.points.map(point => `${x(point.asOf)},${y(point.savedCents)}`).join(' ')

  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex items-end justify-between gap-3 text-xs text-ink-muted tabular-nums' aria-hidden>
        <span>{formatCalendarDate(first.asOf, 'MMM d')}</span>
        <span>Today</span>
      </div>
      <svg aria-hidden viewBox='0 0 100 100' preserveAspectRatio='none' className='h-12 w-full overflow-visible'>
        <line
          x1='0'
          x2='100'
          y1={y(targetCents)}
          y2={y(targetCents)}
          strokeWidth='1.5'
          strokeDasharray='4 4'
          vectorEffect='non-scaling-stroke'
          className='stroke-ink-muted'
        />
        <line x1='0' x2='100' y1='100' y2='100' strokeWidth='1' vectorEffect='non-scaling-stroke' className='stroke-line-strong' />
        <polygon points={`0,100 ${line} 100,100`} className='fill-positive/10' />
        <polyline
          points={line}
          fill='none'
          strokeWidth='2'
          strokeLinejoin='round'
          strokeLinecap='round'
          vectorEffect='non-scaling-stroke'
          className='stroke-positive'
        />
      </svg>
      <p className='text-sm text-ink-muted'>
        <span className='sr-only'>
          {money(first.savedCents)} on {formatCalendarDate(first.asOf, 'MMMM d')}, {money(last.savedCents)} today.{' '}
        </span>
        {rateText(history, reached, money)}
      </p>
    </div>
  )
}

interface GoalLineProps {
  history: GoalHistoryValue
  targetCents: number
  reached: boolean
  currency: string
}

function rateText(history: GoalHistoryValue, reached: boolean, money: (cents: number) => string): string | null {
  const { perMonthCents, projectedOn } = history
  if (reached || perMonthCents === null) return null
  if (perMonthCents <= 0) return 'Nothing added over the last three months'
  if (projectedOn === null) return `About ${money(perMonthCents)} a month lately`
  return `About ${money(perMonthCents)} a month lately, which gets there by ${formatCalendarDate(projectedOn, 'MMMM yyyy')}`
}
