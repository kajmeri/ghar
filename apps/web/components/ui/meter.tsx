import { cn } from '@/lib/utils'
import type { PillTone } from './pill'

const FILLS = {
  neutral: 'bg-ink',
  positive: 'bg-positive',
  caution: 'bg-caution',
  negative: 'bg-negative',
} as const

/**
 * A hairline bar for progress against a limit: packing done, budget used. Over 100% stays
 * full and lets the colour do the talking, because a bar that overflows reads as a bug.
 */
export function Meter({
  ratio,
  tone = 'neutral',
  label,
  className,
}: {
  ratio: number
  tone?: PillTone
  label: string
  className?: string
}) {
  const percent = Math.round(Math.min(Math.max(ratio, 0), 1) * 100)
  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-pill bg-line', className)}
      role='progressbar'
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={cn('h-full rounded-pill', FILLS[tone])} style={{ width: `${percent}%` }} />
    </div>
  )
}
