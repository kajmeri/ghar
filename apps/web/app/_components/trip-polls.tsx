'use client'

import {
  addTripPollOption,
  deleteTripPoll,
  deleteTripPollOption,
  openTripPoll,
  pickTripPollOption,
  updateTripPoll,
  voteOnTripPollOption,
  type PollKindValue,
  type TripPoll,
  type TripPollOption,
  type TripPollsValue,
} from '@ghar/contracts'
import { formatCalendarDate } from '@ghar/core/dates'
import { OPTION_VOTES, nextOptionVote, type OptionVote } from '@ghar/core/itinerary'
import { POLL_TITLES, POLL_VOTE_LABELS } from '@ghar/core/trip-polls'
import { formatTripDates } from '@ghar/core/trips'
import { useState, type SyntheticEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { Pill } from '@/components/ui/pill'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { formText } from '@/lib/form'

// "When works?" and "Where to?" on a trip, for the household on the trip page and for guests on
// theirs. Everything goes through /api/v1, so the phone does the same; the server says who may do
// what, and this only hides what they can't.

interface TripPollsProps {
  tripId: string
  value: TripPollsValue
  /** The kinds the household might still want to ask about: no dates yet, or no place. */
  offer: readonly PollKindValue[]
  /** The earliest date a range or deadline can take, in the host's zone. */
  today?: string
}

export function TripPolls({ tripId, value, offer, today }: TripPollsProps) {
  const open = new Set(value.polls.map(poll => poll.kind))
  const startable = value.canManage ? offer.filter(kind => !open.has(kind)) : []
  const start = useMutation((kind: PollKindValue) => api.request(openTripPoll, { params: { tripId }, body: { kind } }))

  if (value.polls.length === 0 && startable.length === 0) return null

  return (
    <section aria-labelledby='polls-heading' className='flex flex-col gap-3'>
      <div className='flex flex-col gap-1'>
        <h2 id='polls-heading' className='text-lg font-semibold'>
          Decide together
        </h2>
        <p className='text-sm text-ink-muted'>
          {value.canManage ? 'Everyone on the trip can add options and vote. You make the call.' : 'Add what works for you and vote.'}
        </p>
      </div>

      {value.polls.map(poll => (
        <PollCard key={poll.id} tripId={tripId} poll={poll} canVote={value.canVote} canManage={value.canManage} today={today} />
      ))}

      {startable.length > 0 ? (
        <div className='flex flex-col gap-2 rounded-card border border-dashed border-line p-4'>
          <p className='text-sm text-ink-muted'>
            {value.polls.length === 0 ? 'Not sure yet? Ask everyone before you settle it.' : 'Ask about something else.'}
          </p>
          <div className='flex flex-col gap-2 md:flex-row'>
            {startable.map(kind => (
              <Button
                key={kind}
                variant='outline'
                disabled={start.pending}
                onClick={() => {
                  start.mutate(kind)
                }}
              >
                {kind === 'dates' ? 'Ask when works' : 'Ask where to go'}
              </Button>
            ))}
          </div>
          <FormError>{start.error}</FormError>
        </div>
      ) : null}
    </section>
  )
}

/** How a count reads: "3 can go · 1 maybe · 2 can’t". */
const TALLY_WORDS: Record<PollKindValue, Record<OptionVote, string>> = {
  dates: { yes: 'can go', maybe: 'maybe', no: 'can’t' },
  place: { yes: 'yes', maybe: 'maybe', no: 'no' },
}

type PollAction =
  | { type: 'vote'; optionId: string; vote: OptionVote | null }
  | { type: 'delete-option'; optionId: string }
  | { type: 'pick'; optionId: string }
  | { type: 'close' }
  | { type: 'decide-by'; decideBy: string | null }

function PollCard({
  tripId,
  poll,
  canVote,
  canManage,
  today,
}: {
  tripId: string
  poll: TripPoll
  canVote: boolean
  canManage: boolean
  today?: string
}) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [editingDeadline, setEditingDeadline] = useState(false)
  const params = { tripId, pollId: poll.id }

  const action = useMutation(async (next: PollAction) => {
    switch (next.type) {
      case 'vote':
        await api.request(voteOnTripPollOption, { params: { ...params, optionId: next.optionId }, body: { vote: next.vote } })
        return
      case 'delete-option':
        await api.request(deleteTripPollOption, { params: { ...params, optionId: next.optionId } })
        return
      case 'pick':
        await api.request(pickTripPollOption, { params: { ...params, optionId: next.optionId } })
        setConfirming(null)
        return
      case 'close':
        await api.request(deleteTripPoll, { params })
        return
      case 'decide-by':
        await api.request(updateTripPoll, { params, body: { decideBy: next.decideBy } })
        setEditingDeadline(false)
        return
    }
  })

  const add = useMutation(async (form: HTMLFormElement, data: FormData) => {
    const body =
      poll.kind === 'dates'
        ? { startsOn: formText(data, 'startsOn'), endsOn: formText(data, 'endsOn') }
        : { label: formText(data, 'label') }
    await api.request(addTripPollOption, { params, body })
    form.reset()
  })

  const onAdd = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    add.mutate(event.currentTarget, new FormData(event.currentTarget))
  }

  const onDeadline = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const decideBy = formText(new FormData(event.currentTarget), 'decideBy')
    action.mutate({ type: 'decide-by', decideBy: decideBy === '' ? null : decideBy })
  }

  const pending = action.pending || add.pending
  const labels = POLL_VOTE_LABELS[poll.kind]
  const counted = TALLY_WORDS[poll.kind]

  return (
    <article aria-labelledby={`poll-${poll.id}`} className='flex flex-col gap-4 rounded-card border border-line bg-surface p-4'>
      <header className='flex flex-col gap-1'>
        <div className='flex items-start justify-between gap-3'>
          <h3 id={`poll-${poll.id}`} className='text-base font-semibold'>
            {POLL_TITLES[poll.kind]}
          </h3>
          <span className='shrink-0 text-sm text-ink-muted tabular-nums'>
            {poll.voters === 0 ? 'No votes yet' : poll.voters === 1 ? '1 person voted' : `${String(poll.voters)} people voted`}
          </span>
        </div>
        {editingDeadline ? (
          <form onSubmit={onDeadline} className='flex flex-col gap-2 md:flex-row md:items-end'>
            <Field label='Decide by' className='md:w-56'>
              <Input name='decideBy' type='date' min={today} defaultValue={poll.decideBy ?? ''} />
            </Field>
            <div className='flex gap-2'>
              <Button type='submit' disabled={pending}>
                {action.pending ? 'Saving…' : 'Save date'}
              </Button>
              <Button
                type='button'
                variant='ghost'
                onClick={() => {
                  setEditingDeadline(false)
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className='flex flex-wrap items-center gap-x-3'>
            <p className='text-sm text-ink-muted tabular-nums'>
              {poll.decideBy ? `Deciding by ${formatCalendarDate(poll.decideBy, 'EEE, MMM d')}` : 'No date to decide by'}
            </p>
            {canManage ? (
              <button
                type='button'
                onClick={() => {
                  setEditingDeadline(true)
                }}
                className='min-h-tap text-sm text-ink underline underline-offset-2'
              >
                {poll.decideBy ? 'Change' : 'Set a date'}
              </button>
            ) : null}
          </div>
        )}
      </header>

      {poll.options.length === 0 ? (
        <p className='rounded-control border border-dashed border-line px-3 py-4 text-sm text-ink-muted'>
          {poll.kind === 'dates' ? 'No dates yet. Add a range that works for you.' : 'No places yet. Add somewhere you’d like to go.'}
        </p>
      ) : (
        <ul className='flex flex-col divide-y divide-line'>
          {poll.options.map(option => (
            <OptionRow
              key={option.id}
              kind={poll.kind}
              option={option}
              leading={option.id === poll.leaderId}
              labels={labels}
              counted={counted}
              canVote={canVote}
              canManage={canManage}
              confirming={confirming === option.id}
              pending={pending}
              onAction={action.mutate}
              onConfirm={setConfirming}
            />
          ))}
        </ul>
      )}
      <FormError>{action.error}</FormError>

      {canVote ? (
        <form onSubmit={onAdd} className='flex flex-col gap-2 border-t border-line pt-4'>
          {poll.kind === 'dates' ? (
            <div className='grid grid-cols-2 gap-2'>
              <Field label='From'>
                <Input name='startsOn' type='date' min={today} required />
              </Field>
              <Field label='To'>
                <Input name='endsOn' type='date' min={today} required />
              </Field>
            </div>
          ) : (
            <Field label='A place'>
              <Input name='label' maxLength={120} required placeholder='Lisbon' />
            </Field>
          )}
          <Button type='submit' variant='outline' disabled={pending} className='md:self-start'>
            {add.pending ? 'Adding…' : poll.kind === 'dates' ? 'Add dates' : 'Add place'}
          </Button>
          <FormError>{add.error}</FormError>
        </form>
      ) : null}

      {canManage ? (
        <button
          type='button'
          disabled={pending}
          onClick={() => {
            action.mutate({ type: 'close' })
          }}
          className='min-h-tap w-fit text-sm text-ink-muted underline underline-offset-2 disabled:opacity-40'
        >
          Close without deciding
        </button>
      ) : null}
    </article>
  )
}

function OptionRow({
  kind,
  option,
  leading,
  labels,
  counted,
  canVote,
  canManage,
  confirming,
  pending,
  onAction,
  onConfirm,
}: {
  kind: PollKindValue
  option: TripPollOption
  leading: boolean
  labels: Record<OptionVote, string>
  counted: Record<OptionVote, string>
  canVote: boolean
  canManage: boolean
  confirming: boolean
  pending: boolean
  onAction: (action: PollAction) => void
  onConfirm: (optionId: string | null) => void
}) {
  const name = optionName(option)
  const tally = [
    option.yes > 0 ? `${String(option.yes)} ${counted.yes}` : null,
    option.maybe > 0 ? `${String(option.maybe)} ${counted.maybe}` : null,
    option.no > 0 ? `${String(option.no)} ${counted.no}` : null,
  ].filter(Boolean)

  return (
    <li className='flex flex-col gap-2 py-3'>
      <div className='flex items-start justify-between gap-3'>
        <div className='flex min-w-0 flex-col gap-0.5'>
          <p className='text-base font-medium break-words tabular-nums'>{name}</p>
          <p className='text-sm text-ink-muted tabular-nums'>
            {[tally.length > 0 ? tally.join(' · ') : 'No votes yet', option.addedBy ? `Added by ${option.addedBy}` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {leading ? <Pill>Ahead</Pill> : null}
      </div>

      {canVote ? (
        <div role='group' aria-label={`Your answer for ${name}`} className='flex gap-1.5'>
          {OPTION_VOTES.map(vote => (
            <button
              key={vote}
              type='button'
              aria-pressed={option.myVote === vote}
              disabled={pending}
              onClick={() => {
                onAction({ type: 'vote', optionId: option.id, vote: nextOptionVote(option.myVote, vote) })
              }}
              className='flex min-h-tap flex-1 items-center justify-center rounded-control border border-line bg-surface px-2 text-sm text-ink-muted enabled:hover:bg-paper disabled:opacity-40 aria-pressed:border-ink aria-pressed:font-medium aria-pressed:text-ink'
            >
              {labels[vote]}
            </button>
          ))}
        </div>
      ) : null}

      {confirming ? (
        <div className='flex flex-col gap-2 rounded-control border border-line bg-paper p-3'>
          <p className='text-sm'>{kind === 'dates' ? `Set the trip to ${name}?` : `Make ${name} the destination?`} This closes the poll.</p>
          <div className='flex gap-2'>
            <Button
              disabled={pending}
              onClick={() => {
                onAction({ type: 'pick', optionId: option.id })
              }}
            >
              {pending ? 'Settling…' : kind === 'dates' ? 'Set dates' : 'Set destination'}
            </Button>
            <Button
              variant='ghost'
              onClick={() => {
                onConfirm(null)
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : canManage || option.canDelete ? (
        <div className='flex flex-wrap gap-x-4'>
          {canManage ? (
            <button
              type='button'
              disabled={pending}
              onClick={() => {
                onConfirm(option.id)
              }}
              className='min-h-tap text-sm text-ink underline underline-offset-2 disabled:opacity-40'
            >
              Go with this
            </button>
          ) : null}
          {option.canDelete ? (
            <button
              type='button'
              disabled={pending}
              onClick={() => {
                onAction({ type: 'delete-option', optionId: option.id })
              }}
              className='min-h-tap text-sm text-ink-muted underline underline-offset-2 disabled:opacity-40'
            >
              Remove
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

function optionName(option: TripPollOption): string {
  if (option.label !== null) return option.label
  return formatTripDates({ startsOn: option.startsOn, endsOn: option.endsOn })
}
