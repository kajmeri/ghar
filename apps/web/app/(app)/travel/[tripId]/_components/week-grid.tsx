'use client'

import type { ItinerarySlot } from '@ghar/contracts'
import { formatCalendarDate } from '@ghar/core/dates'
import { SLOT_BANDS, SLOT_BAND_LABELS, chosenOptionOf, partitionOptions, slotShape, slotsInCell, type SlotBand } from '@ghar/core/itinerary'
import { Plus } from 'lucide-react'
import { Fragment, useState, type DragEvent } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { FormError } from '@/components/ui/form-error'
import { positioned } from '@/lib/travel/itinerary-display'
import { cn } from '@/lib/utils'
import { useItinerary } from './itinerary-context'
import { SlotKindIcon } from './slot-kind-icon'
import { useSlotAction } from './use-slot-action'

const PAGE = 7

/**
 * The whole trip at a glance, for rearranging it: days across, parts of the day down. Drag a
 * slot to another cell to move it, or onto another slot to put it before that one. Wide
 * screens only; on a phone the slot's own sheet has "Move to".
 */
export function WeekGrid({ className }: { className?: string }) {
  const { days, today, slots, slotById, canEdit, openSlot, openSheet } = useItinerary()
  const action = useSlotAction()
  const [start, setStart] = useState(() => {
    const index = days.findIndex(day => day >= today)
    return Math.max(0, Math.min(index === -1 ? 0 : index, days.length - PAGE))
  })
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)

  if (days.length === 0) {
    return (
      <EmptyState title='Give the trip dates to see it by week' className={className}>
        Set the dates in the trip settings and each day gets a column here.
      </EmptyState>
    )
  }

  const visible = days.slice(start, start + PAGE)
  const positions = slots.map(positioned)

  const drop = (day: string, band: SlotBand, beforeId: string | null) => {
    const slotId = dragging
    setDragging(null)
    setOver(null)
    const slot = slotId === null ? undefined : slotById.get(slotId)
    if (!slot) return

    const cell = slotsInCell(positions, day, band)
    const without = cell.filter(entry => entry.id !== slot.id)
    const toIndex = beforeId === null ? without.length : without.findIndex(entry => entry.id === beforeId)
    if (toIndex < 0) return
    if (slot.day === day && slot.band === band && cell.findIndex(entry => entry.id === slot.id) === toIndex) return

    action.mutate({ type: 'move', slotId: slot.id, day, band, toIndex })
  }

  const allowDrop = (event: DragEvent, key: string) => {
    if (dragging === null) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setOver(key)
  }

  const first = visible[0]
  const last = visible.at(-1)

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className='flex items-center justify-between gap-3'>
        <p className='text-sm text-ink-muted'>
          {first && last ? `${formatCalendarDate(first, 'MMM d')} – ${formatCalendarDate(last, 'MMM d')}` : null}
        </p>
        {days.length > PAGE ? (
          <div className='flex gap-2'>
            <Button
              variant='outline'
              disabled={start === 0}
              onClick={() => {
                setStart(Math.max(0, start - PAGE))
              }}
            >
              Earlier
            </Button>
            <Button
              variant='outline'
              disabled={start + PAGE >= days.length}
              onClick={() => {
                setStart(Math.min(days.length - PAGE, start + PAGE))
              }}
            >
              Later
            </Button>
          </div>
        ) : null}
      </div>

      <FormError>{action.error}</FormError>

      <div
        className='grid overflow-hidden rounded-card border border-line bg-surface'
        style={{ gridTemplateColumns: `5.5rem repeat(${visible.length}, minmax(0, 1fr))` }}
      >
        <div />
        {visible.map(day => (
          <div key={day} className={cn('border-l border-line px-2 py-2 text-sm', day === today ? 'font-medium text-ink' : 'text-ink-muted')}>
            {formatCalendarDate(day, 'EEE d')}
          </div>
        ))}

        {SLOT_BANDS.map(band => (
          <Fragment key={band}>
            <div className='border-t border-line px-3 py-2 text-sm text-ink-muted'>{SLOT_BAND_LABELS[band]}</div>
            {visible.map(day => {
              const key = `${day}|${band}`
              const cell = slotsInCell(positions, day, band)
              return (
                <div
                  key={key}
                  onDragOver={event => {
                    allowDrop(event, key)
                  }}
                  onDragLeave={() => {
                    if (over === key) setOver(null)
                  }}
                  onDrop={event => {
                    event.preventDefault()
                    drop(day, band, null)
                  }}
                  className={cn('group flex min-h-16 flex-col gap-1 border-t border-l border-line p-1', over === key && 'bg-paper')}
                >
                  {cell.map(({ slot }) => (
                    <SlotChip
                      key={slot.id}
                      slot={slot}
                      where={`${formatCalendarDate(day, 'EEE, MMM d')}, ${SLOT_BAND_LABELS[band].toLowerCase()}`}
                      draggable={canEdit && !action.pending}
                      lifted={dragging === slot.id}
                      onOpen={() => {
                        openSlot(slot)
                      }}
                      onDragStart={event => {
                        event.dataTransfer.setData('text/plain', slot.id)
                        event.dataTransfer.effectAllowed = 'move'
                        setDragging(slot.id)
                      }}
                      onDragEnd={() => {
                        setDragging(null)
                        setOver(null)
                      }}
                      onDragOver={event => {
                        allowDrop(event, key)
                      }}
                      onDrop={event => {
                        event.preventDefault()
                        event.stopPropagation()
                        drop(day, band, slot.id)
                      }}
                    />
                  ))}
                  {canEdit ? (
                    <button
                      type='button'
                      onClick={() => {
                        openSheet({ kind: 'add-slot', day, band })
                      }}
                      // Hover reveals it for a mouse; a touch screen has no hover, so there it always shows at full tap size.
                      className='flex h-7 items-center justify-center rounded-control text-ink-muted opacity-0 group-hover:opacity-100 hover:bg-paper focus-visible:opacity-100 pointer-coarse:h-tap pointer-coarse:opacity-100'
                    >
                      <Plus aria-hidden className='size-4' />
                      <span className='sr-only'>
                        Add a slot, {formatCalendarDate(day, 'EEE, MMM d')} {SLOT_BAND_LABELS[band].toLowerCase()}
                      </span>
                    </button>
                  ) : null}
                </div>
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

function SlotChip({
  slot,
  where,
  draggable,
  lifted,
  onOpen,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  slot: ItinerarySlot
  /** The day and part of the day, which the grid shows by position and a screen reader can't see. */
  where: string
  draggable: boolean
  lifted: boolean
  onOpen: () => void
  onDragStart: (event: DragEvent) => void
  onDragEnd: () => void
  onDragOver: (event: DragEvent) => void
  onDrop: (event: DragEvent) => void
}) {
  const shape = slotShape(slot)
  const chosen = chosenOptionOf(slot)
  const count = partitionOptions(slot.options).active.length
  const text =
    shape === 'decided' && chosen ? chosen.title : shape === 'debating' ? `${slot.label} · ${count} ${count === 1 ? 'option' : 'options'}` : slot.label

  return (
    <button
      type='button'
      draggable={draggable}
      title={text}
      onClick={onOpen}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        'flex min-h-8 w-full items-center gap-1.5 rounded-control border px-2 text-left text-xs pointer-coarse:min-h-tap',
        shape === 'decided' && 'border-line bg-surface text-ink',
        shape === 'debating' && 'border-ink/30 bg-paper text-ink',
        (shape === 'empty' || shape === 'skipped') && 'border-dashed border-line text-ink-muted',
        shape === 'skipped' && 'line-through',
        draggable && 'cursor-grab active:cursor-grabbing',
        lifted && 'opacity-40'
      )}
    >
      <SlotKindIcon kind={slot.kind} className='size-3.5' />
      <span className='min-w-0 flex-1 truncate'>
        {text}
        <span className='sr-only'>, {where}</span>
      </span>
    </button>
  )
}
