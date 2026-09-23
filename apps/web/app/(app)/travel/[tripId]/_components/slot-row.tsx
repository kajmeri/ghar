'use client'

import type { ItinerarySlot } from '@ghar/contracts'
import { chosenOptionOf, partitionOptions, slotShape } from '@ghar/core/itinerary'
import { Check, ChevronDown, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TONE_TEXT, costCell, emptySlotPrompt, slotTimeLabel, travelCell } from '@/lib/travel/itinerary-display'
import { cn } from '@/lib/utils'
import { useItinerary } from './itinerary-context'
import { OptionGrid, RejectedOptions } from './option-compare'
import { SlotKindIcon } from './slot-kind-icon'
import { SlotWarnings } from './slot-warnings'

const TIME = 'w-[4.5rem] shrink-0 text-sm tabular-nums text-ink-muted'
const LINE = 'flex min-h-tap w-full items-center gap-3 rounded-control py-1.5 text-left active:bg-ink/5'

/**
 * One slot on the day timeline, and almost always one line. Decided reads as what is happening;
 * still being debated reads as a chip that opens the options in place; empty is an invitation.
 */
export function SlotRow({ slot }: { slot: ItinerarySlot }) {
  const { timeZone, travelers, density, expanded, setExpanded, openSheet, canEdit, warningsBySlot } = useItinerary()
  const shape = slotShape(slot)
  const time = slotTimeLabel(slot, timeZone)
  const comfortable = density === 'comfortable'
  const chosen = chosenOptionOf(slot)
  const warnings = (warningsBySlot.get(slot.id) ?? []).filter(
    warning => warning.optionId === null || (chosen !== null && warning.optionId === chosen.id)
  )

  let body
  if (shape === 'decided' && chosen) {
    const secondary = chosen.subtitle ?? chosen.address ?? (chosen.title === slot.label ? null : slot.label)
    body = (
      <button
        type='button'
        className={LINE}
        onClick={() => {
          openSheet({ kind: 'slot', slotId: slot.id })
        }}
      >
        <SlotKindIcon kind={slot.kind} />
        <span className={TIME}>{time}</span>
        <span className='flex min-w-0 flex-1 flex-col'>
          <span className='truncate'>{chosen.title}</span>
          {comfortable && secondary ? <span className='truncate text-sm text-ink-muted'>{secondary}</span> : null}
        </span>
        {slot.status === 'booked' ? (
          <span className='shrink-0 text-ink-muted'>
            <Check aria-hidden className='size-4' />
            <span className='sr-only'>Booked</span>
          </span>
        ) : null}
        <span className='shrink-0 text-sm tabular-nums'>{chosen.costCents === null ? '' : costCell(chosen, travelers).text}</span>
      </button>
    )
  } else if (shape === 'debating') {
    const open = expanded.has(slot.id)
    const { active } = partitionOptions(slot.options)
    body = (
      <>
        <button
          type='button'
          aria-expanded={open}
          className={LINE}
          onClick={() => {
            setExpanded(slot.id, !open)
          }}
        >
          <SlotKindIcon kind={slot.kind} />
          <span className={TIME}>{time}</span>
          <span className='flex min-w-0 flex-1 flex-col items-start'>
            <span className='inline-flex max-w-full items-center gap-1 rounded-pill border border-line px-2.5 py-0.5 text-sm'>
              <span className='truncate'>
                {slot.label} · {active.length} {active.length === 1 ? 'option' : 'options'}
              </span>
              <ChevronDown aria-hidden className={cn('size-4 shrink-0 text-ink-muted', open && 'rotate-180')} />
            </span>
            {comfortable && slot.notes ? <span className='mt-0.5 truncate text-sm text-ink-muted'>{slot.notes}</span> : null}
          </span>
        </button>
        {open ? <ExpandedOptions slot={slot} /> : null}
      </>
    )
  } else if (shape === 'empty') {
    body = canEdit ? (
      <div className='-mx-3 py-1'>
        <button
          type='button'
          className='flex min-h-tap w-full items-center gap-3 rounded-control border border-dashed border-line px-3 text-left text-ink-muted hover:bg-surface'
          onClick={() => {
            openSheet({ kind: 'add-option', slotId: slot.id })
          }}
        >
          <SlotKindIcon kind={slot.kind} />
          <span className={TIME}>{time}</span>
          <span className='min-w-0 flex-1 truncate text-sm'>{emptySlotPrompt(slot)}</span>
          <Plus aria-hidden className='size-4 shrink-0' />
        </button>
      </div>
    ) : (
      <button
        type='button'
        className={cn(LINE, 'text-ink-muted hover:text-ink')}
        onClick={() => {
          openSheet({ kind: 'slot', slotId: slot.id })
        }}
      >
        <SlotKindIcon kind={slot.kind} />
        <span className={TIME}>{time}</span>
        <span className='min-w-0 flex-1 truncate text-sm'>{slot.label} · nothing yet</span>
      </button>
    )
  } else {
    body = (
      <button
        type='button'
        className={cn(LINE, 'text-ink-muted hover:text-ink')}
        onClick={() => {
          openSheet({ kind: 'slot', slotId: slot.id })
        }}
      >
        <SlotKindIcon kind={slot.kind} />
        <span className={TIME}>{time}</span>
        <span className='min-w-0 flex-1 truncate text-sm'>{slot.label} · skipped</span>
      </button>
    )
  }

  return (
    <div className='flex flex-col'>
      {body}
      <SlotWarnings warnings={warnings} className='pb-2 pl-[7rem]' />
    </div>
  )
}

/**
 * The options, opened in place. A phone gets one line each with the two things that usually
 * decide it, price and how far; the full comparison is a tap away. A wide screen gets the grid.
 */
function ExpandedOptions({ slot }: { slot: ItinerarySlot }) {
  const { facts, travelers, openSheet, canEdit } = useItinerary()
  const { active } = partitionOptions(slot.options)

  return (
    <div className='flex flex-col gap-3 pb-3 md:pl-[7rem]'>
      <ul className='flex flex-col divide-y divide-line rounded-card border border-line bg-surface md:hidden'>
        {active.map(option => {
          const travel = travelCell(facts.get(option.id))
          return (
            <li key={option.id}>
              <button
                type='button'
                className='flex min-h-tap w-full items-center gap-3 px-3 py-1.5 text-left hover:bg-paper active:bg-ink/5'
                onClick={() => {
                  openSheet({ kind: 'compare', slotId: slot.id, focusOptionId: option.id })
                }}
              >
                <span className='min-w-0 flex-1 truncate'>{option.title}</span>
                <span className={cn('shrink-0 text-xs tabular-nums', travel.unknown ? 'text-ink-muted' : TONE_TEXT[travel.tone])}>
                  {travel.unknown ? '' : travel.text}
                </span>
                <span className='w-16 shrink-0 text-right text-sm tabular-nums'>{costCell(option, travelers).text}</span>
              </button>
            </li>
          )
        })}
      </ul>

      <div className='flex gap-2 md:hidden'>
        <Button
          variant='outline'
          className='flex-1'
          onClick={() => {
            openSheet({ kind: 'compare', slotId: slot.id })
          }}
        >
          Compare
        </Button>
        {canEdit ? (
          <Button
            variant='ghost'
            onClick={() => {
              openSheet({ kind: 'add-option', slotId: slot.id })
            }}
          >
            <Plus aria-hidden className='size-4' />
            Add an option
          </Button>
        ) : null}
      </div>

      <div className='hidden flex-col gap-3 md:flex'>
        <OptionGrid slot={slot} />
        <RejectedOptions slot={slot} />
        {canEdit ? (
          <Button
            variant='ghost'
            className='self-start'
            onClick={() => {
              openSheet({ kind: 'add-option', slotId: slot.id })
            }}
          >
            <Plus aria-hidden className='size-4' />
            Add an option
          </Button>
        ) : null}
      </div>
    </div>
  )
}
