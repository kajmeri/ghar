import type { NetWorthGlanceValue } from '@ghar/contracts'
import { daysBetween, formatCalendarDate } from '@ghar/core/dates'
import { formatCents } from '@ghar/core/money'
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { NET_WORTH_PATH } from '@/lib/networth/display'
import { cn } from '@/lib/utils'

const CARD =
  'flex min-h-tap items-center gap-4 rounded-card border border-line bg-surface p-4 transition-colors hover:bg-paper focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden md:p-6'

/**
 * Net worth on the Money screen: the latest figure, how it moved over a month, and the last few
 * months as a small line for the shape. Going up is the good news here, the opposite of spending.
 */
export function NetWorthGlance({ glance, currency }: { glance: NetWorthGlanceValue; currency: string }) {
  const money = (cents: number) => formatCents(cents, { currency })
  const change = glance.month
  const changeText =
    change === null
      ? `As of ${formatCalendarDate(glance.asOf, 'MMM d')}`
      : change.cents === 0
        ? 'No change over the last month'
        : `${change.cents > 0 ? 'Up' : 'Down'} ${money(Math.abs(change.cents))} over the last month`

  return (
    <Link href={NET_WORTH_PATH} className={CARD}>
      <span className='min-w-0 flex-1'>
        <span className='block font-medium'>Net worth</span>
        <span className='amount block text-2xl'>{money(glance.netCents)}</span>
        <span
          className={cn(
            'block text-sm tabular-nums',
            change === null || change.cents === 0 ? 'text-ink-muted' : change.cents > 0 ? 'text-positive' : 'text-negative'
          )}
        >
          {changeText}
        </span>
      </span>
      <Sparkline glance={glance} />
      <ChevronRight aria-hidden className='size-5 shrink-0 text-ink-muted' />
    </Link>
  )
}

/** The last few months, drawn between the bounds core set. Only there once there's a line to draw. */
function Sparkline({ glance }: { glance: NetWorthGlanceValue }) {
  const first = glance.points[0]
  const last = glance.points.at(-1)
  if (!first || !last || first.asOf === last.asOf) return null
  const days = daysBetween(first.asOf, last.asOf)
  const range = glance.maxCents - glance.minCents
  // Nothing owned and nothing owed is a flat line in the middle rather than on the floor.
  const y = (cents: number) => (range === 0 ? 50 : ((glance.maxCents - cents) / range) * 100)
  const points = glance.points.map(point => `${(daysBetween(first.asOf, point.asOf) / days) * 100},${y(point.netCents)}`).join(' ')
  return (
    <svg aria-hidden viewBox='0 0 100 100' preserveAspectRatio='none' className='h-12 w-24 shrink-0 overflow-visible sm:w-40'>
      <polyline
        points={points}
        fill='none'
        strokeWidth='2'
        strokeLinejoin='round'
        strokeLinecap='round'
        vectorEffect='non-scaling-stroke'
        className='stroke-ink'
      />
    </svg>
  )
}
