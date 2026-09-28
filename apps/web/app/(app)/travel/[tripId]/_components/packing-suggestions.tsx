'use client'

import {
  addPackingSuggestions,
  dismissPackingSuggestions,
  restorePackingSuggestions,
  type PackingSuggestions,
  type Person,
} from '@ghar/contracts'
import { namesPhrase } from '@ghar/core/packing-suggestions'
import { personLabel } from '@ghar/core/people'
import { Plus } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'

/**
 * What Ghar thinks the trip needs, from who is going and what is booked. Nothing goes on the list
 * until someone taps add; a dismissed one stays hidden on this trip for everyone.
 */
export function PackingSuggestionsCard({
  tripId,
  value,
  people,
}: {
  tripId: string
  value: PackingSuggestions
  /** To name a traveller Ghar needs a birth date for. */
  people: Person[]
}) {
  const add = useMutation((keys: string[]) => api.request(addPackingSuggestions, { params: { tripId }, body: { keys } }))
  const dismiss = useMutation((key: string) => api.request(dismissPackingSuggestions, { params: { tripId }, body: { keys: [key] } }))
  const restore = useMutation(() => api.request(restorePackingSuggestions, { params: { tripId } }))
  const busy = add.pending || dismiss.pending || restore.pending

  const { suggestions, dismissedCount, unknownAgeTravellerIds } = value
  const unknownAges = unknownAgeTravellerIds.flatMap(personId => {
    const person = people.find(candidate => candidate.id === personId)
    // By name, even for the viewer: "how old You is" reads badly.
    return person ? [personLabel(person, '')] : []
  })

  if (suggestions.length === 0 && dismissedCount === 0 && unknownAges.length === 0) return null

  return (
    <section aria-labelledby='suggestions-heading' className='rounded-card border border-line bg-surface p-4'>
      <div className='flex items-center justify-between gap-3'>
        <h2 id='suggestions-heading' className='font-semibold'>
          Suggested for this trip
        </h2>
        {suggestions.length > 1 ? (
          <Button
            variant='outline'
            disabled={busy}
            onClick={() => {
              add.mutate(suggestions.map(suggestion => suggestion.key))
            }}
          >
            {add.pending ? 'Adding…' : 'Add all'}
          </Button>
        ) : null}
      </div>

      {suggestions.length === 0 ? (
        <p className='mt-1 text-ink-muted'>Nothing new to suggest.</p>
      ) : (
        <ul className='mt-2 flex flex-col divide-y divide-line'>
          {suggestions.map(suggestion => (
            <li key={suggestion.key} className='flex items-start gap-2 py-2.5'>
              <div className='min-w-0 flex-1 self-center'>
                <p className='font-medium break-words'>{suggestion.label}</p>
                <p className='text-sm text-ink-muted'>{suggestion.reason}</p>
              </div>
              <Button
                variant='outline'
                size='icon'
                aria-label={`Add ${suggestion.label}`}
                title='Add to the list'
                disabled={busy}
                onClick={() => {
                  add.mutate([suggestion.key])
                }}
              >
                <Plus aria-hidden />
              </Button>
              <button
                type='button'
                aria-label={`Dismiss ${suggestion.label}`}
                className='inline-flex min-h-tap shrink-0 items-center px-2 text-sm text-ink-muted underline underline-offset-4 hover:text-ink disabled:opacity-40'
                disabled={busy}
                onClick={() => {
                  dismiss.mutate(suggestion.key)
                }}
              >
                Dismiss
              </button>
            </li>
          ))}
        </ul>
      )}

      {dismissedCount > 0 ? (
        <p className='mt-2 flex flex-wrap items-center gap-x-2 text-sm text-ink-muted'>
          {dismissedCount === 1 ? '1 dismissed.' : `${dismissedCount} dismissed.`}
          <button
            type='button'
            className='inline-flex min-h-tap items-center underline underline-offset-4 hover:text-ink disabled:opacity-40'
            disabled={busy}
            onClick={() => {
              restore.mutate()
            }}
          >
            {restore.pending ? 'Bringing back…' : dismissedCount === 1 ? 'Show it again' : 'Show them again'}
          </button>
        </p>
      ) : null}

      {unknownAges.length > 0 ? (
        <div className='mt-2 text-sm text-ink-muted'>
          <p>
            Ghar doesn’t know how old {namesPhrase(unknownAges)} {unknownAges.length === 1 ? 'is' : 'are'}, so it can’t suggest a car seat
            or a stroller.
          </p>
          <Link
            href='/settings/household'
            className='inline-flex min-h-tap items-center text-ink underline underline-offset-4 hover:text-ink-muted'
          >
            Add a birth date
          </Link>
        </div>
      ) : null}

      <FormError>{add.error ?? dismiss.error ?? restore.error}</FormError>
    </section>
  )
}
