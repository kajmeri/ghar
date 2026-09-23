'use client'

import type { ItinerarySlot } from '@ghar/contracts'
import { formatCalendarDate } from '@ghar/core/dates'
import { SLOT_BANDS, SLOT_BAND_LABELS, chosenOptionOf, partitionOptions, slotShape, slotsInCell, type SlotBand } from '@ghar/core/itinerary'
import { Plus } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { ConfirmDialog } from '@/app/(app)/_components/ui/confirm-dialog'
import { Sheet } from '@/app/(app)/_components/ui/sheet'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Field, Select } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import {
  TONE_TEXT,
  bookingCell,
  costCell,
  durationCell,
  hoursCell,
  mapLink,
  positioned,
  slotWhenLabel,
  travelCell,
  type Cell,
} from '@/lib/travel/itinerary-display'
import { cn } from '@/lib/utils'
import { AddOptionSheet } from './add-option'
import { ConfirmationCode } from './confirmation-code'
import { useItinerary } from './itinerary-context'
import { OptionCards, OptionGrid, RejectedOptions } from './option-compare'
import { EditOptionSheet } from './option-form'
import { SlotFormSheet, isBand } from './slot-form'
import { SlotWarnings } from './slot-warnings'
import { useSlotAction } from './use-slot-action'

/** Whichever sheet is open over the itinerary. Render once, inside the ItineraryProvider. */
export function SlotSheets() {
  const { sheet, slotById } = useItinerary()
  if (!sheet) return null
  if (sheet.kind === 'add-slot') return <SlotFormSheet key={`add-slot-${sheet.day}`} day={sheet.day} band={sheet.band} />

  // A slot deleted or moved out from under an open sheet takes the sheet with it.
  const slot = slotById.get(sheet.slotId)
  if (!slot) return null

  switch (sheet.kind) {
    case 'slot':
      return <SlotDetailSheet key={`slot-${slot.id}`} slot={slot} />
    case 'compare':
      return <CompareSheet key={`compare-${slot.id}`} slot={slot} focusOptionId={sheet.focusOptionId} />
    case 'add-option':
      return <AddOptionSheet key={`add-option-${slot.id}`} slot={slot} />
    case 'edit-slot':
      return <SlotFormSheet key={`edit-slot-${slot.id}`} slot={slot} />
    case 'edit-option': {
      const option = slot.options.find(each => each.id === sheet.optionId)
      return option ? <EditOptionSheet key={`edit-option-${option.id}`} slot={slot} option={option} /> : null
    }
  }
}

/** A settled slot, and everything needed to act on it. */
function SlotDetailSheet({ slot }: { slot: ItinerarySlot }) {
  const { timeZone, travelers, facts, warningsBySlot, canEdit, openSheet, closeSheet } = useItinerary()
  const action = useSlotAction()
  const shape = slotShape(slot)
  const chosen = chosenOptionOf(slot)
  const optionFacts = chosen ? facts.get(chosen.id) : undefined
  const warnings = (warningsBySlot.get(slot.id) ?? []).filter(warning => warning.optionId === null || warning.optionId === chosen?.id)
  const map = chosen ? mapLink(chosen) : null
  const optionCount = slot.options.length

  return (
    <Sheet
      open
      onOpenChange={open => {
        if (!open) closeSheet()
      }}
      title={chosen?.title ?? slot.label}
      description={`${chosen && chosen.title !== slot.label ? `${slot.label} · ` : ''}${slotWhenLabel(slot, timeZone)}`}
    >
      <div className='flex flex-col gap-5'>
        <SlotWarnings warnings={warnings} />

        {shape === 'skipped' ? <p className='text-sm text-ink-muted'>Skipped. Reopen it to plan something here again.</p> : null}
        {shape === 'empty' ? <p className='text-sm text-ink-muted'>Nothing added for this yet.</p> : null}

        {chosen ? (
          <dl className='grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm'>
            {chosen.subtitle ? <Detail label='About'>{chosen.subtitle}</Detail> : null}
            {chosen.address || map ? (
              <Detail label='Where'>
                {map ? (
                  <a href={map} target='_blank' rel='noreferrer noopener' className='underline underline-offset-4'>
                    {chosen.address ?? 'Open in maps'}
                  </a>
                ) : (
                  chosen.address
                )}
              </Detail>
            ) : null}
            <CellDetail label='Cost' cell={costCell(chosen, travelers)} />
            <CellDetail label='Takes' cell={durationCell(chosen)} />
            <CellDetail label='Getting there' cell={travelCell(optionFacts)} />
            <CellDetail label='Hours' cell={hoursCell(chosen, optionFacts)} />
            {chosen.confirmationCode ? (
              <Detail label='Confirmation'>
                <ConfirmationCode code={chosen.confirmationCode} />
              </Detail>
            ) : chosen.bookingRequired ? (
              <CellDetail label='Reservation' cell={bookingCell(chosen, optionFacts)} />
            ) : null}
            {(chosen.bookingUrl ?? chosen.url) ? (
              <Detail label='Link'>
                <a
                  href={chosen.bookingUrl ?? chosen.url ?? undefined}
                  target='_blank'
                  rel='noreferrer noopener'
                  className='break-all underline underline-offset-4'
                >
                  {chosen.bookingUrl ? 'Open the booking' : 'Open the link'}
                </a>
              </Detail>
            ) : null}
            {chosen.tags.length > 0 ? <Detail label='Tags'>{chosen.tags.join(', ')}</Detail> : null}
            {chosen.notes ? (
              <Detail label='Notes'>
                <span className='whitespace-pre-line'>{chosen.notes}</span>
              </Detail>
            ) : null}
          </dl>
        ) : null}

        {slot.notes ? <p className='text-sm whitespace-pre-line text-ink-muted'>{slot.notes}</p> : null}

        <FormError>{action.error}</FormError>

        {canEdit ? (
          <div className='flex flex-wrap gap-2'>
            {shape === 'empty' ? (
              <Button
                onClick={() => {
                  openSheet({ kind: 'add-option', slotId: slot.id })
                }}
              >
                <Plus aria-hidden className='size-4' />
                Add an option
              </Button>
            ) : null}
            {shape === 'debating' ? (
              <Button
                onClick={() => {
                  openSheet({ kind: 'compare', slotId: slot.id })
                }}
              >
                Compare options
              </Button>
            ) : null}
            {chosen ? (
              <Button
                variant='outline'
                onClick={() => {
                  openSheet({ kind: 'edit-option', slotId: slot.id, optionId: chosen.id })
                }}
              >
                Edit details
              </Button>
            ) : null}
            {chosen || shape === 'skipped' ? (
              <Button
                variant='outline'
                disabled={action.pending}
                onClick={() => {
                  action.mutate({ type: 'reopen', slotId: slot.id })
                }}
              >
                {shape === 'skipped' ? 'Reopen' : optionCount > 1 ? 'Change the choice' : 'Reopen'}
              </Button>
            ) : null}
            <Button
              variant='ghost'
              onClick={() => {
                openSheet({ kind: 'edit-slot', slotId: slot.id })
              }}
            >
              Edit slot
            </Button>
            {shape === 'skipped' ? null : (
              <Button
                variant='ghost'
                disabled={action.pending}
                onClick={() => {
                  action.mutate({ type: 'skip', slotId: slot.id })
                }}
              >
                Skip
              </Button>
            )}
            <ConfirmDialog
              trigger={<Button variant='ghost'>Delete slot</Button>}
              title='Delete this slot?'
              description={
                optionCount === 0
                  ? 'It comes off the day.'
                  : `It comes off the day with its ${optionCount === 1 ? 'option' : `${optionCount} options`} and their votes. To keep them, skip it instead.`
              }
              confirmLabel='Delete slot'
              pendingLabel='Deleting…'
              tone='destructive'
              pending={action.pending}
              error={action.error}
              onConfirm={() => {
                action.mutate({ type: 'delete-slot', slotId: slot.id })
              }}
            />
          </div>
        ) : null}

        {canEdit ? <MoveSlot slot={slot} /> : null}
      </div>
    </Sheet>
  )
}

/**
 * The phone's and the keyboard's way to rearrange, where dragging across a week is not on offer:
 * a day, a part of the day, and a place among what is already there.
 */
function MoveSlot({ slot }: { slot: ItinerarySlot }) {
  const { days, slots } = useItinerary()
  const action = useSlotAction()
  const [day, setDay] = useState(slot.day)
  const [band, setBand] = useState<SlotBand>(slot.band)
  const positions = slots.map(positioned)
  const currentIndex = slotsInCell(positions, slot.day, slot.band).findIndex(entry => entry.id === slot.id)
  const others = slotsInCell(positions, day, band).filter(entry => entry.id !== slot.id)
  // Null means last, which is where a slot moved to another part of the day lands.
  const [chosenIndex, setChosenIndex] = useState<number | null>(currentIndex < 0 ? null : currentIndex)
  const toIndex = Math.min(chosenIndex ?? others.length, others.length)
  const unchanged = day === slot.day && band === slot.band && toIndex === currentIndex

  return (
    <section className='flex flex-col gap-3 border-t border-line pt-4'>
      <h3 className='text-sm font-medium'>Move to</h3>
      <div className='grid grid-cols-2 gap-3'>
        <Field label='Day'>
          <Select
            value={day}
            onChange={event => {
              setDay(event.target.value)
              setChosenIndex(null)
            }}
          >
            {days.map(each => (
              <option key={each} value={each}>
                {formatCalendarDate(each, 'EEE, MMM d')}
              </option>
            ))}
          </Select>
        </Field>
        <Field label='Part of the day'>
          <Select
            value={band}
            onChange={event => {
              if (!isBand(event.target.value)) return
              setBand(event.target.value)
              setChosenIndex(null)
            }}
          >
            {SLOT_BANDS.map(each => (
              <option key={each} value={each}>
                {SLOT_BAND_LABELS[each]}
              </option>
            ))}
          </Select>
        </Field>
        {others.length > 0 ? (
          <Field label='Place' className='col-span-2'>
            <Select
              value={String(toIndex)}
              onChange={event => {
                setChosenIndex(Number(event.target.value))
              }}
            >
              {[null, ...others].map((before, index) => (
                <option key={before?.id ?? 'first'} value={index}>
                  {before ? `After ${before.slot.label}` : 'First'}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
      <FormError>{action.error}</FormError>
      <Button
        variant='outline'
        disabled={unchanged || action.pending}
        onClick={() => {
          action.mutate({ type: 'move', slotId: slot.id, day, band, toIndex })
        }}
      >
        {action.pending ? 'Moving…' : 'Move'}
      </Button>
    </section>
  )
}

/**
 * The options side by side, full height. Cards on a phone, a grid on a wide screen. Choosing
 * one closes this and folds the slot back to a single line.
 */
function CompareSheet({ slot, focusOptionId }: { slot: ItinerarySlot; focusOptionId?: string }) {
  const { timeZone, canEdit, openSheet, closeSheet } = useItinerary()
  const { active } = partitionOptions(slot.options)

  // Tapping one restaurant in the row opens the comparison at that restaurant.
  useEffect(() => {
    if (!focusOptionId) return
    const frame = requestAnimationFrame(() => {
      document.getElementById(`option-card-${focusOptionId}`)?.scrollIntoView({ block: 'start' })
    })
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [focusOptionId])

  return (
    <Sheet
      open
      size='full'
      onOpenChange={open => {
        if (!open) closeSheet()
      }}
      title={slot.label}
      description={`${slotWhenLabel(slot, timeZone)} · ${active.length} ${active.length === 1 ? 'option' : 'options'}`}
    >
      <div className='flex flex-col gap-4'>
        {active.length === 0 ? (
          <EmptyState
            title='Every option is ruled out'
            action={
              canEdit ? (
                <Button
                  onClick={() => {
                    openSheet({ kind: 'add-option', slotId: slot.id })
                  }}
                >
                  Add an option
                </Button>
              ) : undefined
            }
          >
            Restore one from the rejected list, or add another to weigh up.
          </EmptyState>
        ) : (
          <>
            <OptionCards slot={slot} className='md:hidden' />
            <OptionGrid slot={slot} className='hidden md:flex' />
          </>
        )}
        <RejectedOptions slot={slot} />
        {canEdit && active.length > 0 ? (
          <Button
            variant='outline'
            className='self-stretch md:self-start'
            onClick={() => {
              openSheet({ kind: 'add-option', slotId: slot.id })
            }}
          >
            <Plus aria-hidden className='size-4' />
            Add an option
          </Button>
        ) : null}
      </div>
    </Sheet>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className='contents'>
      <dt className='text-ink-muted'>{label}</dt>
      <dd className='min-w-0 tabular-nums'>{children}</dd>
    </div>
  )
}

/** A compare attribute, left out of the sheet when nothing is known about it. */
function CellDetail({ label, cell }: { label: string; cell: Cell }) {
  if (cell.unknown) return null
  return (
    <Detail label={label}>
      <span className={TONE_TEXT[cell.tone]}>{cell.text}</span>
      {cell.detail ? (
        <span className={cn('block text-xs', cell.tone === 'neutral' ? 'text-ink-muted' : TONE_TEXT[cell.tone])}>{cell.detail}</span>
      ) : null}
    </Detail>
  )
}
