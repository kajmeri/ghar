'use client'

import type { ItineraryOption, ItinerarySlot } from '@ghar/contracts'
import { OPTION_VOTES, leadingOptionId, nextOptionVote, optionVoteOf, partitionOptions, type OptionVote } from '@ghar/core/itinerary'
import { ChevronDown, ExternalLink, Pencil, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FormError } from '@/components/ui/form-error'
import { Pill } from '@/components/ui/pill'
import { COMPARE_ATTRIBUTES, TONE_TEXT, compareRows, costCell, optionCells, type Cell } from '@/lib/travel/itinerary-display'
import { cn } from '@/lib/utils'
import { useItinerary } from './itinerary-context'
import { useSlotAction } from './use-slot-action'

const VOTE_LABELS: Record<OptionVote, string> = { yes: 'Yes', maybe: 'Maybe', no: 'No' }

/**
 * The options in a slot, side by side. On a phone, stacked cards that put every attribute in the
 * same place on each card, so the eye can drop straight down the list. On a wide screen, a grid:
 * options across, attributes down, with the rows where they all agree pushed into the background.
 */
export function OptionCards({ slot, className }: { slot: ItinerarySlot; className?: string }) {
  const { facts, travelers } = useItinerary()
  const action = useSlotAction()
  const { active } = partitionOptions(slot.options)
  const leader = leadingOptionId(slot.options)

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <FormError>{action.error}</FormError>
      <ul className='flex flex-col gap-3'>
        {active.map(option => {
          const cells = optionCells(option, facts.get(option.id), travelers)
          return (
            <li key={option.id} id={`option-card-${option.id}`} className='scroll-mt-4'>
              <Card className='flex flex-col gap-4 p-4'>
                <OptionHeading option={option} leading={option.id === leader} />
                <dl className='grid grid-cols-2 gap-x-4 gap-y-3'>
                  {COMPARE_ATTRIBUTES.map(({ key, label }) => (
                    <div key={key} className='min-w-0'>
                      <dt className='text-xs text-ink-muted'>{label}</dt>
                      <dd className='text-sm'>
                        <CellValue cell={cells[key]} />
                      </dd>
                    </div>
                  ))}
                </dl>
                <VoteButtons slotId={slot.id} option={option} pending={action.pending} onVote={action.mutate} />
                <OptionActions slotId={slot.id} option={option} pending={action.pending} onAction={action.mutate} />
              </Card>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function OptionGrid({ slot, className }: { slot: ItinerarySlot; className?: string }) {
  const { facts, travelers } = useItinerary()
  const action = useSlotAction()
  const { active } = partitionOptions(slot.options)
  const leader = leadingOptionId(slot.options)
  const rows = compareRows(active, facts, travelers)

  if (active.length === 0) return null

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <FormError>{action.error}</FormError>
      <table className='w-full table-fixed border-collapse text-sm'>
        <colgroup>
          <col className='w-32' />
          {active.map(option => (
            <col key={option.id} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <td />
            {active.map(option => (
              <th key={option.id} scope='col' className='pr-4 pb-3 text-left align-bottom font-normal'>
                <OptionHeading option={option} leading={option.id === leader} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.key} className='border-t border-line'>
              <th scope='row' className='py-2.5 pr-3 text-left align-top font-normal text-ink-muted'>
                {row.label}
              </th>
              {row.cells.map((cell, index) => {
                const option = active[index]
                return (
                  <td key={option?.id ?? index} className='py-2.5 pr-4 align-top'>
                    <CellValue cell={cell} muted={!row.varies} emphasised={row.varies} />
                    {row.key === 'votes' && option ? (
                      <VoteButtons slotId={slot.id} option={option} pending={action.pending} onVote={action.mutate} className='mt-2' />
                    ) : null}
                  </td>
                )
              })}
            </tr>
          ))}
          <tr className='border-t border-line'>
            <td />
            {active.map(option => (
              <td key={option.id} className='py-3 pr-4 align-top'>
                <OptionActions slotId={slot.id} option={option} pending={action.pending} onAction={action.mutate} stacked />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/** Ruled-out options stay on record, greyed and folded away, and can come back. */
export function RejectedOptions({ slot }: { slot: ItinerarySlot }) {
  const { travelers, canEdit } = useItinerary()
  const action = useSlotAction()
  const { rejected } = partitionOptions(slot.options)
  if (rejected.length === 0) return null

  return (
    <details className='group rounded-card border border-line'>
      <summary className='flex min-h-tap list-none items-center justify-between gap-3 px-4 text-sm text-ink-muted [&::-webkit-details-marker]:hidden'>
        {rejected.length} rejected
        <ChevronDown aria-hidden className='size-4 group-open:rotate-180' />
      </summary>
      <FormError>{action.error}</FormError>
      <ul className='divide-y divide-line border-t border-line'>
        {rejected.map(option => (
          <li key={option.id} className='flex min-h-tap items-center gap-3 pl-4 text-sm text-ink-muted'>
            <span className='min-w-0 flex-1 truncate'>{option.title}</span>
            <span className='shrink-0 tabular-nums'>{costCell(option, travelers).text}</span>
            {canEdit ? (
              <Button
                variant='ghost'
                disabled={action.pending}
                onClick={() => {
                  action.mutate({ type: 'restore', slotId: slot.id, optionId: option.id })
                }}
              >
                <Undo2 aria-hidden className='size-4' />
                Restore
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  )
}

function OptionHeading({ option, leading }: { option: ItineraryOption; leading: boolean }) {
  const secondary = option.subtitle ?? option.address
  return (
    <div className='flex min-w-0 flex-col gap-1'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='min-w-0 text-base font-medium break-words text-ink'>{option.title}</span>
        {option.status === 'chosen' ? <Pill tone='positive'>Chosen</Pill> : null}
        {leading ? <Pill>Most votes</Pill> : null}
      </div>
      {secondary ? <span className='text-sm break-words text-ink-muted'>{secondary}</span> : null}
    </div>
  )
}

function CellValue({ cell, muted = false, emphasised = false }: { cell: Cell; muted?: boolean; emphasised?: boolean }) {
  return (
    <span className='flex flex-col tabular-nums'>
      <span
        className={cn(
          cell.unknown || muted ? 'text-ink-muted' : TONE_TEXT[cell.tone],
          cell.tone !== 'neutral' && !cell.unknown && TONE_TEXT[cell.tone],
          emphasised && !cell.unknown && 'font-medium'
        )}
      >
        {cell.text}
      </span>
      {cell.detail ? (
        <span className={cn('text-xs', cell.tone === 'neutral' ? 'text-ink-muted' : TONE_TEXT[cell.tone])}>{cell.detail}</span>
      ) : null}
    </span>
  )
}

/** Tapping your own vote again takes it back. Everyone on the household can vote. */
function VoteButtons({
  slotId,
  option,
  pending,
  onVote,
  className,
}: {
  slotId: string
  option: ItineraryOption
  pending: boolean
  onVote: (action: { type: 'vote'; slotId: string; optionId: string; vote: OptionVote | null }) => void
  className?: string
}) {
  const { currentUserId } = useItinerary()
  const mine = optionVoteOf(option.votes, currentUserId)

  return (
    <div role='group' aria-label={`Your vote on ${option.title}`} className={cn('flex gap-1.5', className)}>
      {OPTION_VOTES.map(vote => (
        <button
          key={vote}
          type='button'
          aria-pressed={mine === vote}
          disabled={pending}
          onClick={() => {
            onVote({ type: 'vote', slotId, optionId: option.id, vote: nextOptionVote(mine, vote) })
          }}
          className='flex min-h-tap flex-1 items-center justify-center rounded-control border border-line bg-surface px-2 text-sm text-ink-muted enabled:hover:bg-paper disabled:opacity-40 aria-pressed:border-ink aria-pressed:font-medium aria-pressed:text-ink'
        >
          {VOTE_LABELS[vote]}
        </button>
      ))}
    </div>
  )
}

function OptionActions({
  slotId,
  option,
  pending,
  onAction,
  stacked = false,
}: {
  slotId: string
  option: ItineraryOption
  pending: boolean
  onAction: (action: { type: 'choose' | 'reject'; slotId: string; optionId: string }) => void
  stacked?: boolean
}) {
  const { canEdit, openSheet } = useItinerary()
  const link = option.url ?? option.bookingUrl

  return (
    <div className={cn('flex gap-2', stacked ? 'flex-wrap' : 'items-center')}>
      {canEdit && option.status !== 'chosen' ? (
        <Button
          className={cn(!stacked && 'flex-1')}
          disabled={pending}
          onClick={() => {
            onAction({ type: 'choose', slotId, optionId: option.id })
          }}
        >
          Choose
        </Button>
      ) : null}
      {canEdit ? (
        <Button
          variant='outline'
          disabled={pending}
          onClick={() => {
            onAction({ type: 'reject', slotId, optionId: option.id })
          }}
        >
          Reject
        </Button>
      ) : null}
      {canEdit ? (
        <Button
          variant='ghost'
          size='icon'
          onClick={() => {
            openSheet({ kind: 'edit-option', slotId, optionId: option.id })
          }}
        >
          <Pencil aria-hidden className='size-4' />
          <span className='sr-only'>Edit {option.title}</span>
        </Button>
      ) : null}
      {link ? (
        <Button asChild variant='ghost' size='icon'>
          <a href={link} target='_blank' rel='noreferrer noopener'>
            <ExternalLink aria-hidden className='size-4' />
            <span className='sr-only'>Open the link for {option.title}</span>
          </a>
        </Button>
      ) : null}
    </div>
  )
}
