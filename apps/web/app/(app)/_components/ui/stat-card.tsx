import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type Sentiment = 'positive' | 'negative' | 'neutral'

export interface StatDelta {
  direction: 'up' | 'down' | 'flat'
  /**
   * Whether the change is good news, which the direction alone can't say: spending going up is
   * negative, income going up is positive.
   */
  sentiment: Sentiment
  /** The size of the change, already formatted: "$120.00" or "12%". */
  value: string
  /** What it's measured against: "vs last month". */
  label?: string
}

const TONE: Record<Sentiment, string> = {
  positive: 'text-positive',
  negative: 'text-negative',
  neutral: 'text-ink-muted',
}

const DIRECTION = {
  up: { icon: ArrowUpRight, label: 'Up' },
  down: { icon: ArrowDownRight, label: 'Down' },
  flat: { icon: Minus, label: 'No change' },
} as const

/** One figure and what it means. The value arrives formatted, through formatCents for money. */
export function StatCard({ label, value, delta, className }: { label: string; value: string; delta?: StatDelta; className?: string }) {
  return (
    <div className={cn('@container rounded-card border border-line bg-surface p-4 md:p-5', className)}>
      <dl className='flex flex-col gap-1'>
        <dt className='text-sm text-ink-muted'>{label}</dt>
        {/* Scales with the card so a figure never breaks across lines in a narrow column. */}
        <dd className='amount text-[length:clamp(var(--text-lg),15cqi,var(--text-3xl))] leading-9 [overflow-wrap:anywhere]'>{value}</dd>
        {delta ? <Delta {...delta} /> : null}
      </dl>
    </div>
  )
}

function Delta({ direction, sentiment, value, label }: StatDelta) {
  const { icon: Icon, label: directionLabel } = DIRECTION[direction]
  return (
    <dd className='flex flex-wrap items-center gap-x-1.5 text-sm'>
      <span className={cn('inline-flex items-center gap-0.5 font-medium', TONE[sentiment])}>
        <Icon aria-hidden className='size-4' />
        <span className='sr-only'>{directionLabel} </span>
        {value}
      </span>
      {label ? <span className='text-ink-muted'>{label}</span> : null}
    </dd>
  )
}

/**
 * Lays stat cards out by the room they have, not the viewport: two across on a phone, one row
 * once there's space for it.
 */
export function StatGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('@container', className)}>
      <div className='grid grid-cols-1 gap-3 @xs:grid-cols-2 @4xl:auto-cols-fr @4xl:grid-flow-col @4xl:grid-cols-none'>{children}</div>
    </div>
  )
}
