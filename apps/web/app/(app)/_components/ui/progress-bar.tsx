import { progressFraction, progressStatus, type ProgressStatus } from '@ghar/core/progress'
import { CircleAlert, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

const FILL: Record<ProgressStatus, string> = {
  under: 'bg-positive',
  approaching: 'bg-caution-ink',
  over: 'bg-negative',
}

// Caution never colors words: approaching keeps ink text and puts caution-ink in the icon.
const DETAIL: Record<ProgressStatus, string> = {
  under: 'text-ink-muted',
  approaching: 'text-ink',
  over: 'text-negative',
}

const STATUS_LABEL: Record<ProgressStatus, string> = {
  under: 'under the limit',
  approaching: 'approaching the limit',
  over: 'over the limit',
}

/**
 * A running total against its limit: a budget, a quota. The color comes from the status core
 * works out, never from the caller, and the words say it too, so color is never the only signal.
 */
export function ProgressBar({
  label,
  value,
  max,
  valueText,
  detail,
  approachingAt,
  marker,
  className,
}: {
  label: string
  /** In the same unit as max: cents for money. */
  value: number
  max: number
  /** The figures, formatted: "$412.50 of $500.00". */
  valueText?: string
  /** One line under the bar: "$87.50 left" or "$42.10 over". */
  detail?: string
  /** The fraction of max where the bar turns to caution. Defaults to 80%. */
  approachingAt?: number
  /**
   * A tick at this fraction of the bar, for where the value would be if it went evenly: how far a
   * month has got. Left off at either end, where it would only sit on the bar's edge.
   */
  marker?: number
  className?: string
}) {
  // A limit can go below zero, like a budget line whose overspend carried into this month. Nothing
  // is left under it, so it reads as a limit of zero: over the moment anything is spent.
  const limit = Math.max(max, 0)
  const status = progressStatus(value, limit, { approachingAt })
  const percent = progressFraction(value, limit) * 100

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className='flex flex-wrap items-baseline justify-between gap-x-3'>
        <p className='min-w-0 font-medium break-words'>{label}</p>
        {valueText ? <p className='text-sm text-ink-muted'>{valueText}</p> : null}
      </div>
      <div className='relative'>
        <div
          role='progressbar'
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(Math.max(value, 0), limit)}
          aria-valuetext={[valueText, STATUS_LABEL[status]].filter(Boolean).join(', ')}
          className='h-2 overflow-hidden rounded-pill bg-line inset-ring inset-ring-line-strong'
        >
          <div className={cn('h-full rounded-pill', FILL[status])} style={{ width: `${percent}%` }} />
        </div>
        {marker !== undefined && marker > 0 && marker < 1 ? (
          <span
            aria-hidden
            className='absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-pill bg-ink ring-2 ring-surface'
            style={{ left: `${marker * 100}%` }}
          />
        ) : null}
      </div>
      {detail ? (
        <p className={cn('flex items-center gap-1.5 text-sm', DETAIL[status])}>
          {status === 'approaching' ? <TriangleAlert aria-hidden className='size-4 shrink-0 text-caution-ink' /> : null}
          {status === 'over' ? <CircleAlert aria-hidden className='size-4 shrink-0' /> : null}
          {detail}
        </p>
      ) : null}
    </div>
  )
}
