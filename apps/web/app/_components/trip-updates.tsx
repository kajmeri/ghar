'use client'

import { deleteTripUpdate, muteTripUpdates, postTripUpdate, TRIP_POST_MAX, type TripUpdate, type TripUpdatesValue } from '@ghar/contracts'
import { formatInstant } from '@ghar/core/dates'
import { TRIP_UPDATE_TITLES, tripUpdateText } from '@ghar/core/trip-updates'
import { useRef, type SyntheticEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Textarea } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { formText } from '@/lib/form'
import { cn } from '@/lib/utils'

// What's new on a trip, for the household on the trip page and for guests on theirs: posts, and
// decisions and bookings, which post themselves. Everything goes through /api/v1, so the phone
// does the same; the server says who may do what, and this only hides what they can't.

export function TripUpdates({ tripId, value, timeZone }: { tripId: string; value: TripUpdatesValue; timeZone: string }) {
  return (
    <section aria-labelledby='updates-heading' className='flex flex-col gap-3'>
      <div className='flex flex-col gap-1'>
        <h2 id='updates-heading' className='text-lg font-semibold'>
          Updates
        </h2>
        <p className='text-sm text-ink-muted'>Posts, and what gets decided or booked. Emailed once a day to everyone on the trip.</p>
      </div>

      {value.canPost ? <Composer tripId={tripId} canEmail={value.canEmail} /> : null}

      {value.updates.length === 0 ? (
        <div className='rounded-card border border-dashed border-line px-4 py-6'>
          <p className='text-base font-medium'>Nothing new yet</p>
          <p className='text-sm text-ink-muted'>
            {value.canPost
              ? 'Post something everyone should know, like when you land. Decisions and bookings show up here on their own.'
              : 'Decisions, bookings and posts show up here as they happen.'}
          </p>
        </div>
      ) : (
        <ol className='flex flex-col divide-y divide-line rounded-card border border-line bg-surface px-4'>
          {value.updates.map(update => (
            <UpdateRow key={update.id} tripId={tripId} update={update} timeZone={timeZone} />
          ))}
        </ol>
      )}

      <MuteSwitch tripId={tripId} muted={value.muted} />
    </section>
  )
}

function Composer({ tripId, canEmail }: { tripId: string; canEmail: boolean }) {
  const form = useRef<HTMLFormElement>(null)
  const post = useMutation(async (body: string, emailNow: boolean) => {
    await api.request(postTripUpdate, { params: { tripId }, body: { body, emailNow } })
    form.current?.reset()
  })

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    post.mutate(formText(data, 'body'), data.get('emailNow') === 'on')
  }

  return (
    <form ref={form} onSubmit={onSubmit} className='flex flex-col gap-3 rounded-card border border-line bg-surface p-4'>
      <Field label='Post an update'>
        <Textarea name='body' required rows={3} maxLength={TRIP_POST_MAX} />
      </Field>
      {canEmail ? (
        <label className='flex min-h-tap items-center gap-3 self-start text-base'>
          <input type='checkbox' name='emailNow' className='size-5 shrink-0 accent-ink' />
          Email everyone now
        </label>
      ) : null}
      <div className='flex flex-col gap-2 md:flex-row md:items-center md:justify-between'>
        <p className='text-sm text-ink-muted'>
          {canEmail ? 'Otherwise it goes out in tomorrow’s email.' : 'Everyone gets it in tomorrow’s email.'}
        </p>
        <Button type='submit' disabled={post.pending} className='md:self-end'>
          {post.pending ? 'Posting…' : 'Post'}
        </Button>
      </div>
      <FormError>{post.error}</FormError>
    </form>
  )
}

function UpdateRow({ tripId, update, timeZone }: { tripId: string; update: TripUpdate; timeZone: string }) {
  const remove = useMutation(() => api.request(deleteTripUpdate, { params: { tripId, updateId: update.id } }))
  const when = formatInstant(new Date(update.createdAt), timeZone, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const isPost = update.kind === 'post'
  const who = update.mine ? 'You' : (update.author ?? (isPost ? 'Someone' : null))
  const title = update.kind === 'post' ? who : TRIP_UPDATE_TITLES[update.kind]
  const byline = [isPost ? null : who, when].filter(Boolean).join(' · ')

  return (
    <li className='flex flex-col gap-1 py-3'>
      <div className='flex items-baseline justify-between gap-3'>
        <p className={cn('text-sm', isPost ? 'font-medium text-ink' : 'text-ink-muted')}>{title}</p>
        <p className='shrink-0 text-sm text-ink-muted tabular-nums'>{byline}</p>
      </div>
      <p className={cn('text-base break-words', isPost && 'whitespace-pre-line')}>{isPost ? update.body : tripUpdateText(update)}</p>
      {update.canDelete ? (
        <button
          type='button'
          disabled={remove.pending}
          onClick={() => {
            remove.mutate()
          }}
          className='min-h-tap w-fit text-sm text-ink-muted underline underline-offset-2 disabled:opacity-40'
        >
          {remove.pending ? 'Removing…' : 'Remove'}
        </button>
      ) : null}
      <FormError>{remove.error}</FormError>
    </li>
  )
}

function MuteSwitch({ tripId, muted }: { tripId: string; muted: boolean }) {
  const toggle = useMutation((next: boolean) => api.request(muteTripUpdates, { params: { tripId }, body: { muted: next } }))
  // Shows where it's going while the change saves.
  const on = toggle.pending ? muted : !muted

  return (
    <div className='flex flex-col gap-1'>
      <button
        type='button'
        role='switch'
        aria-checked={on}
        disabled={toggle.pending}
        onClick={() => {
          toggle.mutate(!muted)
        }}
        className='inline-flex min-h-tap items-center gap-3 self-start rounded-control pr-2 text-left text-base outline-hidden focus-visible:ring-2 focus-visible:ring-ring'
      >
        <span
          aria-hidden
          className={cn(
            'flex h-6 w-10 shrink-0 items-center rounded-pill p-0.5 transition-colors motion-reduce:transition-none',
            on ? 'bg-ink' : 'bg-line-strong'
          )}
        >
          <span
            className={cn('size-5 rounded-pill bg-surface transition-transform motion-reduce:transition-none', on && 'translate-x-4')}
          />
        </span>
        Email me updates
      </button>
      <FormError>{toggle.error}</FormError>
    </div>
  )
}
