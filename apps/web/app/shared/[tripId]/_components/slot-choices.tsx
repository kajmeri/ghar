'use client'

import { deleteSharedOption, suggestSharedOption, voteOnSharedOption, type SharedChoice } from '@ghar/contracts'
import { OPTION_VOTES, nextOptionVote, type OptionVote } from '@ghar/core/itinerary'
import { useState, type SyntheticEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { formText } from '@/lib/form'

const VOTE_LABELS: Record<OptionVote, string> = { yes: 'Yes', maybe: 'Maybe', no: 'No' }

type ChoiceAction = { type: 'vote'; optionId: string; vote: OptionVote | null } | { type: 'delete'; optionId: string }

/**
 * What's in the running for a slot the household hasn't settled, for a guest to vote on or add
 * to. The household still makes the call. A guest can take back their own idea, nobody else's.
 */
export function SlotChoices({
  tripId,
  slotId,
  label,
  choices,
}: {
  tripId: string
  slotId: string
  label: string
  choices: SharedChoice[]
}) {
  const [suggesting, setSuggesting] = useState(false)

  const action = useMutation(async (next: ChoiceAction) => {
    if (next.type === 'vote') {
      await api.request(voteOnSharedOption, { params: { tripId, optionId: next.optionId }, body: { vote: next.vote } })
    } else {
      await api.request(deleteSharedOption, { params: { tripId, optionId: next.optionId } })
    }
  })

  const suggest = useMutation(async (title: string) => {
    await api.request(suggestSharedOption, { params: { tripId, slotId }, body: { title } })
    setSuggesting(false)
  })

  const onSuggest = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    suggest.mutate(formText(new FormData(event.currentTarget), 'title'))
  }

  const pending = action.pending || suggest.pending

  return (
    <div className='flex flex-col gap-3'>
      <ul className='flex flex-col gap-3'>
        {choices.map(choice => (
          <li key={choice.id} className='flex flex-col gap-2 rounded-control border border-line p-3'>
            <div className='flex min-w-0 flex-col gap-0.5'>
              <p className='text-base font-medium break-words'>{choice.title}</p>
              {choice.subtitle ? <p className='text-sm break-words text-ink-muted'>{choice.subtitle}</p> : null}
              <p className='text-sm text-ink-muted tabular-nums'>
                {[tally(choice), choice.mine ? 'Your idea' : choice.addedBy ? `${choice.addedBy}’s idea` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <div role='group' aria-label={`Your vote on ${choice.title}`} className='flex gap-1.5'>
              {OPTION_VOTES.map(vote => (
                <button
                  key={vote}
                  type='button'
                  aria-pressed={choice.myVote === vote}
                  disabled={pending}
                  onClick={() => {
                    action.mutate({ type: 'vote', optionId: choice.id, vote: nextOptionVote(choice.myVote, vote) })
                  }}
                  className='flex min-h-tap flex-1 items-center justify-center rounded-control border border-line bg-surface px-2 text-sm text-ink-muted enabled:hover:bg-paper disabled:opacity-40 aria-pressed:border-ink aria-pressed:font-medium aria-pressed:text-ink'
                >
                  {VOTE_LABELS[vote]}
                </button>
              ))}
            </div>
            {choice.mine ? (
              <button
                type='button'
                disabled={pending}
                onClick={() => {
                  action.mutate({ type: 'delete', optionId: choice.id })
                }}
                className='min-h-tap w-fit text-sm text-ink-muted underline underline-offset-2 disabled:opacity-40'
              >
                Take back my idea
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <FormError>{action.error}</FormError>

      {suggesting ? (
        <form onSubmit={onSuggest} className='flex flex-col gap-2'>
          <Field label={`Your idea for ${label.toLowerCase()}`}>
            <Input name='title' required maxLength={200} autoFocus />
          </Field>
          <div className='flex gap-2'>
            <Button type='submit' disabled={pending}>
              {suggest.pending ? 'Adding…' : 'Add idea'}
            </Button>
            <Button
              type='button'
              variant='ghost'
              onClick={() => {
                setSuggesting(false)
                suggest.clearError()
              }}
            >
              Cancel
            </Button>
          </div>
          <FormError>{suggest.error}</FormError>
        </form>
      ) : (
        <Button
          variant='outline'
          className='md:self-start'
          onClick={() => {
            setSuggesting(true)
          }}
        >
          Suggest something else
        </Button>
      )}
    </div>
  )
}

function tally(choice: SharedChoice): string {
  const parts = [
    choice.yes > 0 ? `${String(choice.yes)} yes` : null,
    choice.maybe > 0 ? `${String(choice.maybe)} maybe` : null,
    choice.no > 0 ? `${String(choice.no)} no` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'No votes yet'
}
