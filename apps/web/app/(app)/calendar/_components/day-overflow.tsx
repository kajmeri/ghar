'use client'

import type { CalendarItem } from '@ghar/contracts'
import type { CalendarDate } from '@ghar/core/dates'
import { Popover } from 'radix-ui'
import { CalendarItemChip } from './calendar-item-chip'

/** "+3 more" in a crowded month cell, opening everything on that day. */
export function DayOverflow({
  count,
  label,
  items,
  date,
  timeZone,
}: {
  count: number
  label: string
  items: CalendarItem[]
  date: CalendarDate
  timeZone: string
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type='button'
          // Last thing in a fixed-height cell, so the hit area reaches down through the empty space
          // below it to about 44px, without covering the chip above.
          className='relative mt-0.5 w-full rounded-control px-1.5 py-0.5 text-left text-sm font-medium text-ink-muted outline-hidden after:absolute after:-inset-x-1 after:-top-px after:-bottom-5 hover:bg-line/60 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring'
        >
          {count} more<span className='sr-only'> on {label}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align='start'
          sideOffset={4}
          collisionPadding={16}
          className='z-50 w-72 rounded-card border border-line bg-surface p-3 shadow-overlay outline-hidden motion-safe:animate-fade-in'
        >
          <p className='px-1.5 pb-2 font-semibold'>{label}</p>
          <ul className='flex flex-col gap-0.5'>
            {items.map(item => (
              <li key={item.id}>
                <CalendarItemChip item={item} date={date} timeZone={timeZone} />
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
