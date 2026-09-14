'use client'

import { deleteItineraryItem, generateItineraryFromBookings, reorderItinerary, type ItineraryItem, type TripDetail } from '@ghar/contracts'
import { formatCalendarDate } from '@ghar/core/dates'
import { groupByDay } from '@ghar/core/itinerary'
import { tripDayNumber } from '@ghar/core/trips'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { ItemForm } from './item-form'
import { ItineraryRow } from './itinerary-row'
import { LinkedBookings } from './linked-bookings'
import { StopMap } from './stop-map'

/**
 * The timeline. One column on the phone, which is the real layout; on a wide screen the
 * same column with the trip's stops plotted beside it, because there is room.
 *
 * Order is the person's, not the clock's: dragging on desktop and the move buttons on
 * mobile both write a position, and @ghar/core decides what the new positions are.
 */
export function ItineraryPanel({ detail }: { detail: TripDetail }) {
  const { trip, itinerary, bookings, timeZone, today } = detail
  const [addingOn, setAddingOn] = useState<string | null>(null)
  const [editing, setEditing] = useState<ItineraryItem | null>(null)

  // Instants are ISO on the wire and the ordering rules want Dates, so the row travels
  // alongside the shape @ghar/core sorts and groups by rather than being converted twice.
  const days = groupByDay(
    itinerary.map(item => ({
      id: item.id,
      day: item.day,
      startsAt: item.startsAt === null ? null : new Date(item.startsAt),
      sortOrder: item.sortOrder,
      item,
    })),
    trip
  )

  const reorder = useMutation((body: ReorderBody) => api.request(reorderItinerary, { params: { tripId: trip.id }, body }))
  const remove = useMutation((itemId: string) => api.request(deleteItineraryItem, { params: { tripId: trip.id, itemId } }))
  const generate = useMutation(() => api.request(generateItineraryFromBookings, { params: { tripId: trip.id }, body: {} }))

  const unlisted = bookings.filter(booking => !itinerary.some(item => item.bookingId === booking.id))

  return (
    <div className='flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8'>
      <div className='flex min-w-0 flex-1 flex-col gap-4'>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            variant='outline'
            onClick={() => {
              setEditing(null)
              setAddingOn(days[0]?.day ?? today)
            }}
          >
            Add to the itinerary
          </Button>
          {unlisted.length > 0 ? (
            <Button
              variant='ghost'
              disabled={generate.pending}
              onClick={() => {
                generate.mutate()
              }}
            >
              {generate.pending ? 'Adding…' : `Add ${unlisted.length} booking${unlisted.length === 1 ? '' : 's'} to the days`}
            </Button>
          ) : null}
        </div>

        <FormError>{reorder.error ?? remove.error ?? generate.error}</FormError>

        {addingOn !== null || editing !== null ? (
          <ItemForm
            tripId={trip.id}
            timeZone={timeZone}
            day={editing?.day ?? addingOn ?? today}
            item={editing}
            onDone={() => {
              setAddingOn(null)
              setEditing(null)
            }}
          />
        ) : null}

        {itinerary.length === 0 ? (
          <EmptyState title='Nothing planned yet'>
            Add the first thing you know about, or link a booking and it becomes a row on the day it happens.
          </EmptyState>
        ) : (
          <ol className='flex flex-col'>
            {days.map(({ day, items }) => (
              <li key={day} className='flex flex-col'>
                <DayHeading day={day} trip={trip} today={today} />
                <DayItems
                  day={day}
                  items={items}
                  timeZone={timeZone}
                  onReorder={reorder.mutate}
                  onEdit={item => {
                    setAddingOn(null)
                    setEditing(item)
                  }}
                  onDelete={remove.mutate}
                  onAdd={() => {
                    setEditing(null)
                    setAddingOn(day)
                  }}
                  busy={reorder.pending || remove.pending}
                />
              </li>
            ))}
          </ol>
        )}

        <LinkedBookings tripId={trip.id} bookings={bookings} timeZone={timeZone} />
      </div>

      <StopMap items={itinerary} className='hidden lg:block lg:w-80 lg:shrink-0' />
    </div>
  )
}

/** One row on the timeline: what @ghar/core orders by, plus the row itself to render. */
interface TimelineEntry {
  id: string
  day: string
  startsAt: Date | null
  sortOrder: number
  item: ItineraryItem
}

type ReorderBody = { itemId: string; day: string; toIndex: number } | { itemId: string; direction: 'up' | 'down' }

function DayHeading({ day, trip, today }: { day: string; trip: TripDetail['trip']; today: string }) {
  const number = tripDayNumber(trip, day)
  return (
    <h3 className='sticky top-0 z-10 -mx-4 bg-paper px-4 py-2 text-sm font-medium md:-mx-8 md:px-8'>
      <span className={cn(day === today && 'text-ink', day !== today && 'text-ink-muted')}>{formatCalendarDate(day, 'EEE, MMM d')}</span>
      {number === null ? null : <span className='text-ink-muted'> · Day {number}</span>}
      {day === today ? <span className='text-ink-muted'> · Today</span> : null}
    </h3>
  )
}

/**
 * Drag and drop, hand-rolled on the platform's own events rather than a library: a list
 * this short does not need one, and the drop target is always "before this row".
 */
function DayItems({
  day,
  items,
  timeZone,
  onReorder,
  onEdit,
  onDelete,
  onAdd,
  busy,
}: {
  day: string
  items: readonly TimelineEntry[]
  timeZone: string
  onReorder: (body: ReorderBody) => void
  onEdit: (item: ItineraryItem) => void
  onDelete: (itemId: string) => void
  onAdd: () => void
  busy: boolean
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  /** The index the dragged item lands at, counted after it has been lifted out. */
  const drop = (beforeId: string | null) => {
    if (draggingId === null) return
    const without = items.filter(item => item.id !== draggingId)
    const toIndex = beforeId === null ? without.length : without.findIndex(i => i.id === beforeId)
    setDraggingId(null)
    setOverId(null)
    if (toIndex >= 0) onReorder({ itemId: draggingId, day, toIndex })
  }

  if (items.length === 0) {
    return (
      <p className='border-l border-line py-3 pl-4 text-sm text-ink-muted'>
        Nothing on this day.{' '}
        <button type='button' className='underline underline-offset-4' onClick={onAdd}>
          Add something
        </button>
      </p>
    )
  }

  return (
    <ol
      className='flex flex-col border-l border-line'
      onDragOver={event => {
        event.preventDefault()
      }}
      onDrop={() => {
        drop(null)
      }}
    >
      {items.map((entry, index) => (
        <li
          key={entry.id}
          draggable={!busy}
          onDragStart={() => {
            setDraggingId(entry.id)
          }}
          onDragEnd={() => {
            setDraggingId(null)
            setOverId(null)
          }}
          onDragOver={event => {
            event.preventDefault()
            setOverId(entry.id)
          }}
          onDrop={event => {
            event.stopPropagation()
            drop(entry.id)
          }}
          className={cn(
            'border-t border-transparent',
            overId === entry.id && draggingId !== entry.id && 'border-t-ink',
            draggingId === entry.id && 'opacity-40'
          )}
        >
          <ItineraryRow
            item={entry.item}
            timeZone={timeZone}
            isFirst={index === 0}
            isLast={index === items.length - 1}
            busy={busy}
            onMove={direction => {
              onReorder({ itemId: entry.id, direction })
            }}
            onEdit={() => {
              onEdit(entry.item)
            }}
            onDelete={() => {
              onDelete(entry.id)
            }}
          />
        </li>
      ))}
    </ol>
  )
}
