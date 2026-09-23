import { progressFraction } from '@ghar/core/progress'
import { cn } from '@/lib/utils'

/**
 * Money put towards something, against what it is for. A limit bar turns red as it fills; this
 * one is the other way round, so it stays positive all the way to the target and says so in words
 * as well as in colour.
 */
export function SavedBar({
  label,
  savedCents,
  targetCents,
  valueText,
  detail,
  className,
}: {
  label: string
  /** Null when nothing stands behind the goal yet, which leaves the track empty. */
  savedCents: number | null
  targetCents: number
  /** The figures, formatted: "$2,500.00 of $10,000.00". */
  valueText?: string
  detail?: React.ReactNode
  className?: string
}) {
  const fraction = savedCents === null ? 0 : progressFraction(savedCents, targetCents)

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className='flex flex-wrap items-baseline justify-between gap-x-3'>
        <p className='min-w-0 font-medium break-words'>{label}</p>
        {valueText ? <p className='text-sm text-ink-muted'>{valueText}</p> : null}
      </div>
      <div
        role='progressbar'
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={targetCents}
        aria-valuenow={savedCents === null ? 0 : Math.min(Math.max(savedCents, 0), targetCents)}
        aria-valuetext={valueText}
        className='h-2 overflow-hidden rounded-pill bg-line inset-ring inset-ring-line-strong'
      >
        <div className='h-full rounded-pill bg-positive' style={{ width: `${fraction * 100}%` }} />
      </div>
      {detail ? <div className='text-sm text-ink-muted'>{detail}</div> : null}
    </div>
  )
}
