'use client'

import { formatCalendarDate } from '@ghar/core/dates'
import { daysOfferingSkeleton, groupSlotsByDay, isOpenDecision, plannedCents } from '@ghar/core/itinerary'
import { formatCents } from '@ghar/core/money'
import { tripDayNumber } from '@ghar/core/trips'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { positioned } from '@/lib/travel/itinerary-display'
import { cn } from '@/lib/utils'
import { useItinerary } from './itinerary-context'
import { ScaffoldOffer } from './scaffold-offer'
import { SlotRow } from './slot-row'

/**
 * The trip a day at a time. Settled slots are one line each, so a whole day fits on a phone
 * screen; the ones still being decided say how many options they have and open in place.
 */
export function Timeline({ className }: { className?: string }) {
  const { trip, today, slots, travelers, dismissedDays, canEdit, openSheet } = useItinerary()
  const grouped = groupSlotsByDay(slots.map(positioned), trip)
  const offering = new Set(daysOfferingSkeleton(trip, slots, dismissedDays))

  if (grouped.length === 0) {
    return (
      <EmptyState
        title='Nothing planned yet'
        className={className}
        action={
          canEdit ? (
            <Button
              onClick={() => {
                openSheet({ kind: 'add-slot', day: today })
              }}
            >
              <Plus aria-hidden className='size-4' />
              Add a slot
            </Button>
          ) : undefined
        }
      >
        Give the trip dates to get a line for each day, or add a slot for the first thing you know you will do.
      </EmptyState>
    )
  }

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {grouped.map(({ day, slots: entries }) => {
        const daySlots = entries.map(entry => entry.slot)
        const open = daySlots.filter(isOpenDecision).length
        const planned = plannedCents(daySlots, travelers)
        const number = tripDayNumber(trip, day)

        return (
          <section key={day} aria-labelledby={`day-${day}`} className='flex flex-col'>
            <header className='sticky top-0 z-10 -mx-4 flex min-h-tap items-center justify-between gap-3 border-b border-line bg-paper px-4 md:-mx-8 md:px-8'>
              <h2 id={`day-${day}`} className='min-w-0 truncate text-sm font-medium'>
                {formatCalendarDate(day, 'EEE, MMM d')}
                <span className='font-normal text-ink-muted'>
                  {number === null ? '' : ` · Day ${number}`}
                  {day === today ? ' · Today' : ''}
                </span>
              </h2>
              <p className='flex shrink-0 items-center gap-3 text-sm tabular-nums'>
                {open > 0 ? <span className='text-caution'>{open} open</span> : null}
                {planned > 0 ? <span className='text-ink-muted'>{formatCents(planned)}</span> : null}
              </p>
            </header>

            {daySlots.length === 0 ? (
              canEdit && offering.has(day) ? (
                <ScaffoldOffer day={day} />
              ) : (
                <p className='py-3 text-sm text-ink-muted'>Nothing on this day.</p>
              )
            ) : (
              <ol className='flex flex-col divide-y divide-line'>
                {daySlots.map(slot => (
                  <li key={slot.id}>
                    <SlotRow slot={slot} />
                  </li>
                ))}
              </ol>
            )}

            {canEdit ? (
              <button
                type='button'
                onClick={() => {
                  openSheet({ kind: 'add-slot', day })
                }}
                className='flex min-h-tap items-center gap-3 text-sm text-ink-muted hover:text-ink print:hidden'
              >
                <Plus aria-hidden className='size-4' />
                Add to this day
              </button>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}
