import type { CalendarItem } from '@ghar/contracts'
import { spanPosition } from '@ghar/core/calendar'
import type { CalendarDate } from '@ghar/core/dates'
import Link from 'next/link'
import { itemHref, itemStartOnDay, TONE_BAR, TONE_DOT } from '@/lib/calendar/display'
import { cn } from '@/lib/utils'

/**
 * One item in a month cell. All-day and multi-day items are bars; timed ones are a dot and a start
 * time. Used by the grid and by its "more" popover, so it stays free of server-only code.
 */
export function CalendarItemChip({ item, date, timeZone }: { item: CalendarItem; date: CalendarDate; timeZone: string }) {
  const href = itemHref(item)
  const start = itemStartOnDay(item, date, timeZone)
  const bar = item.allDay || spanPosition(item, date) !== 'single'

  const content = (
    <>
      {bar ? null : <span aria-hidden className={cn('size-2 shrink-0 rounded-pill', TONE_DOT[item.tone])} />}
      {start ? <span className='shrink-0 text-ink-muted tabular-nums'>{start}</span> : null}
      <span className='truncate'>{item.title}</span>
    </>
  )
  const className = cn(
    'flex min-w-0 items-center gap-1.5 rounded-control px-1.5 py-0.5 text-sm text-ink outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
    bar && ['border-l-2 bg-line/40', TONE_BAR[item.tone]],
    href && 'hover:bg-line/60'
  )

  return href ? (
    <Link href={href} className={className} title={item.title}>
      {content}
    </Link>
  ) : (
    <span className={className} title={item.title}>
      {content}
    </span>
  )
}
