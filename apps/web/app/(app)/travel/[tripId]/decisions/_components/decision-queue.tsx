'use client'

import type { ItineraryOption, ItinerarySlot } from '@ghar/contracts'
import { formatCalendarDate } from '@ghar/core/dates'
import { leadingOptionId, partitionOptions, type DeadlineState } from '@ghar/core/itinerary'
import { ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { FormError } from '@/components/ui/form-error'
import { TONE_TEXT, costCell, slotWhenLabel, travelCell, votesCell } from '@/lib/travel/itinerary-display'
import { cn } from '@/lib/utils'
import { useItinerary } from '../../_components/itinerary-context'
import { SlotKindIcon } from '../../_components/slot-kind-icon'
import { SlotWarnings } from '../../_components/slot-warnings'
import { useSlotAction } from '../../_components/use-slot-action'

export interface Decision {
  slotId: string
  deadline: { date: string; state: DeadlineState } | null
}

const DEADLINE_TEXT: Record<DeadlineState, string> = {
  passed: 'text-negative',
  soon: 'text-caution-ink',
  later: 'text-ink-muted',
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

/**
 * Everything still to decide, most pressing first, each answerable where it sits. On a
 * keyboard: j and k to move, e to open, a number to choose that option, r then a number to
 * rule one out.
 */
export function DecisionQueue({ decisions }: { decisions: readonly Decision[] }) {
  const { tripId, slotById, sheet, canEdit } = useItinerary()
  const action = useSlotAction()
  const rows = decisions.flatMap(decision => {
    const slot = slotById.get(decision.slotId)
    return slot ? [{ slot, deadline: decision.deadline }] : []
  })

  const [active, setActive] = useState(0)
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(rows[0] ? [rows[0].slot.id] : []))
  const [rejecting, setRejecting] = useState(false)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())

  // A decided slot leaves the queue; the one after it moves up into the same place.
  const current = Math.min(active, Math.max(rows.length - 1, 0))
  const currentRow = rows[current]

  const toggle = (slotId: string, next?: boolean) => {
    setOpen(existing => {
      const want = next ?? !existing.has(slotId)
      if (existing.has(slotId) === want) return existing
      const copy = new Set(existing)
      if (want) copy.add(slotId)
      else copy.delete(slotId)
      return copy
    })
  }

  const headingRef = useRef<HTMLHeadingElement>(null)
  // Set when a decision is sent; the effect below moves focus once it has landed.
  const settling = useRef(false)

  const decide = (type: 'choose' | 'reject', slotId: string, optionId: string) => {
    settling.current = true
    action.mutate({ type, slotId, optionId })
  }

  // Deciding removes the button that was pressed: a chosen slot leaves the queue, a ruled-out
  // option leaves its row. Once the page has re-read, focus goes to the row now at this place,
  // or to the heading when nothing is left, instead of falling back to the top of the page.
  useEffect(() => {
    if (!settling.current || action.pending) return
    settling.current = false
    if (action.error) return
    const row = rows[current]
    if (row) rowRefs.current.get(row.slot.id)?.focus()
    else headingRef.current?.focus()
  })

  // Keys belong to the list, so they act only once focus is on a row and never fire from
  // elsewhere on the page.
  const onKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    if (sheet !== null || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return
    const focus = (index: number) => {
      const row = rows[index]
      if (!row) return
      setActive(index)
      setRejecting(false)
      rowRefs.current.get(row.slot.id)?.focus()
    }

    if (event.key === 'j' || event.key === 'ArrowDown') {
      event.preventDefault()
      focus(Math.min(current + 1, rows.length - 1))
    } else if (event.key === 'k' || event.key === 'ArrowUp') {
      event.preventDefault()
      focus(Math.max(current - 1, 0))
    } else if (event.key === 'Escape') {
      setRejecting(false)
    } else if (currentRow && event.key === 'e') {
      toggle(currentRow.slot.id)
    } else if (currentRow && canEdit && event.key === 'r') {
      toggle(currentRow.slot.id, true)
      setRejecting(value => !value)
    } else if (currentRow && canEdit && /^[1-9]$/.test(event.key) && !action.pending) {
      const option = partitionOptions(currentRow.slot.options).active[Number(event.key) - 1]
      if (!option) return
      event.preventDefault()
      decide(rejecting ? 'reject' : 'choose', currentRow.slot.id, option.id)
      setRejecting(false)
    }
  }

  const heading = (
    <h2 ref={headingRef} tabIndex={-1} className='sr-only'>
      Still to decide
    </h2>
  )

  if (rows.length === 0) {
    return (
      <div>
        {heading}
        <EmptyState
          title='Nothing left to decide'
          action={
            <Button asChild variant='outline'>
              <Link href={`/travel/${tripId}`}>Back to the itinerary</Link>
            </Button>
          }
        >
          Every slot has a choice. Add options to a slot to weigh them up here.
        </EmptyState>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-4'>
      {heading}
      <p className='hidden text-sm text-ink-muted md:block' aria-live='polite'>
        {rejecting ? (
          <>
            Rule out which? Press <Key>1</Key>–<Key>9</Key>, or <Key>Esc</Key> to cancel.
          </>
        ) : (
          <>
            On a row: <Key>j</Key> <Key>k</Key> to move · <Key>e</Key> to open · <Key>1</Key>–<Key>9</Key> to choose · <Key>r</Key> then a
            number to rule one out
          </>
        )}
      </p>

      <FormError>{action.error}</FormError>

      <ol className='flex flex-col gap-2' onKeyDown={onKeyDown}>
        {rows.map(({ slot, deadline }, index) => (
          <li key={slot.id}>
            <DecisionRow
              slot={slot}
              deadline={deadline}
              active={index === current}
              open={open.has(slot.id)}
              rejecting={rejecting && index === current}
              pending={action.pending}
              buttonRef={element => {
                if (element) rowRefs.current.set(slot.id, element)
                else rowRefs.current.delete(slot.id)
              }}
              onToggle={() => {
                setActive(index)
                setRejecting(false)
                toggle(slot.id)
              }}
              onChoose={option => {
                setActive(index)
                decide('choose', slot.id, option.id)
              }}
              onReject={option => {
                setActive(index)
                decide('reject', slot.id, option.id)
              }}
            />
          </li>
        ))}
      </ol>
    </div>
  )
}

function DecisionRow({
  slot,
  deadline,
  active,
  open,
  rejecting,
  pending,
  buttonRef,
  onToggle,
  onChoose,
  onReject,
}: {
  slot: ItinerarySlot
  deadline: Decision['deadline']
  active: boolean
  open: boolean
  rejecting: boolean
  pending: boolean
  buttonRef: (element: HTMLButtonElement | null) => void
  onToggle: () => void
  onChoose: (option: ItineraryOption) => void
  onReject: (option: ItineraryOption) => void
}) {
  const { timeZone, travelers, facts, warningsBySlot, canEdit, openSheet } = useItinerary()
  const { active: options, rejected } = partitionOptions(slot.options)
  const leading = leadingOptionId(options)

  return (
    <div className={cn('rounded-card border bg-surface', active ? 'border-ink/40' : 'border-line')}>
      <button
        ref={buttonRef}
        type='button'
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          'flex min-h-tap w-full items-center gap-3 px-3 py-2 text-left hover:bg-paper active:bg-ink/5 md:px-4',
          open ? 'rounded-t-card' : 'rounded-card'
        )}
      >
        <SlotKindIcon kind={slot.kind} />
        <span className='flex min-w-0 flex-1 flex-col'>
          <span className='truncate font-medium'>
            {slot.label} · {options.length} {options.length === 1 ? 'option' : 'options'}
          </span>
          <span className='truncate text-sm text-ink-muted'>
            {formatCalendarDate(slot.day, 'EEE, MMM d')} · {slotWhenLabel(slot, timeZone)}
          </span>
        </span>
        {deadline ? (
          <span className={cn('shrink-0 text-right text-sm tabular-nums', DEADLINE_TEXT[deadline.state])}>
            {deadline.state === 'passed' ? 'Was due ' : 'By '}
            {formatCalendarDate(deadline.date, 'MMM d')}
          </span>
        ) : null}
        <ChevronDown aria-hidden className={cn('size-4 shrink-0 text-ink-muted', open && 'rotate-180')} />
      </button>

      {open ? (
        <div className='flex flex-col gap-3 border-t border-line px-3 pt-2 pb-3 md:px-4'>
          <SlotWarnings warnings={warningsBySlot.get(slot.id) ?? []} />
          <ol className='flex flex-col divide-y divide-line'>
            {options.map((option, index) => {
              const cost = costCell(option, travelers)
              const travel = travelCell(facts.get(option.id))
              const votes = votesCell(option)
              return (
                <li key={option.id} className='flex flex-wrap items-center gap-x-3 gap-y-1 py-2'>
                  {index < 9 ? (
                    <Key className={cn('hidden md:inline-flex', rejecting && 'border-negative/50 text-negative')}>{index + 1}</Key>
                  ) : null}
                  <span className='flex min-w-0 flex-1 basis-40 flex-col'>
                    <span className='truncate'>
                      {option.title}
                      {option.id === leading ? <span className='text-sm text-ink-muted'> · most votes</span> : null}
                    </span>
                    <span className='truncate text-sm text-ink-muted tabular-nums'>
                      {[cost.unknown ? null : cost.text, travel.unknown ? null : travel.text, votes.unknown ? null : votes.text]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {canEdit ? (
                    <span className='flex shrink-0 gap-2'>
                      <Button
                        variant='ghost'
                        disabled={pending}
                        onClick={() => {
                          onReject(option)
                        }}
                        className={TONE_TEXT.neutral}
                      >
                        Rule out
                      </Button>
                      <Button
                        variant='outline'
                        disabled={pending}
                        onClick={() => {
                          onChoose(option)
                        }}
                      >
                        Choose
                      </Button>
                    </span>
                  ) : null}
                </li>
              )
            })}
          </ol>
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              variant='ghost'
              onClick={() => {
                openSheet({ kind: 'compare', slotId: slot.id })
              }}
            >
              Compare side by side
            </Button>
            {canEdit ? (
              <Button
                variant='ghost'
                onClick={() => {
                  openSheet({ kind: 'add-option', slotId: slot.id })
                }}
              >
                Add an option
              </Button>
            ) : null}
            {rejected.length > 0 ? <span className='text-sm text-ink-muted'>{rejected.length} ruled out</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Key({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-control border border-line bg-paper px-1 font-sans text-xs text-ink-muted tabular-nums',
        className
      )}
    >
      {children}
    </kbd>
  )
}
