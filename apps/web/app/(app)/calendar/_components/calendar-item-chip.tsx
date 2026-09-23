import type { CalendarItem } from '@ghar/contracts'
import { spanPosition } from '@ghar/core/calendar'
import type { CalendarDate } from '@ghar/core/dates'
import Link from 'next/link'
import { itemHref, itemStartOnDay, TONE_BAR, TONE_DOT } from '@/lib/calendar/display'
import { cn } from '@/lib/utils'

/**
 * Month cells are too dense for 44px rows, so a linked chip's hit area grows past it without
 * moving anything: sideways into the cell padding, and up and down to meet the next chip's in the
 * gap between them, never over it. Each chip still clears the 24px minimum.
 */
const TAP_AREA = 'relative after:absolute after:-inset-x-1 after:-inset-y-px'

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
      {/* Muted text fails on the darker hover fill, so the time turns ink with it. */}
      {start ? <span className='shrink-0 text-ink-muted tabular-nums group-hover/chip:text-ink'>{start}</span> : null}
      <span className='truncate'>{item.title}</span>
    </>
  )
  const className = cn(
    'flex min-w-0 items-center gap-1.5 rounded-control px-1.5 py-0.5 text-sm text-ink outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
    bar && ['border-l-2 bg-line/40', TONE_BAR[item.tone]],
    href && ['group/chip hover:bg-line/60', TAP_AREA]
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
