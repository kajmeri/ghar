'use client'

import type { TripCalendarFeed } from '@ghar/contracts'
import { useActionState } from 'react'
import { CopyField } from '@/app/_components/copy-field'
import { Button } from '@/components/ui/button'
import { FormMessage } from '@/components/ui/field'
import { IDLE } from '@/lib/actions/state'
import { createCalendarFeedAction, deleteCalendarFeedAction } from '../../actions'

/**
 * The trip in the guest's own calendar, kept up to date as the household plans. A private link:
 * anyone holding it sees the plan, so a new one retires the old.
 */
export function CalendarFeed({ tripId, feed }: { tripId: string; feed: TripCalendarFeed | null }) {
  const [createState, createAction, creating] = useActionState(createCalendarFeedAction, IDLE)
  const [deleteState, deleteAction, deleting] = useActionState(deleteCalendarFeedAction, IDLE)
  const message = [createState, deleteState].find(state => state.status === 'error') ?? (feed ? createState : deleteState)

  if (!feed) {
    return (
      <div className='flex flex-col gap-3'>
        <p className='text-base text-ink-muted'>
          Put the trip’s dates and plan in your calendar. It updates as plans are made, so there’s nothing to keep in sync.
        </p>
        <form action={createAction}>
          <input type='hidden' name='tripId' value={tripId} />
          <Button type='submit' disabled={creating} className='w-full md:w-auto'>
            {creating ? 'Getting it ready…' : 'Add to calendar'}
          </Button>
        </form>
        <FormMessage state={message} />
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-4'>
      <Button asChild className='w-full md:w-auto md:self-start'>
        <a href={feed.webcalUrl}>Open in calendar</a>
      </Button>
      <div className='flex flex-col gap-2'>
        <p className='text-sm text-ink-muted'>Or copy the link into your calendar app’s “subscribe” or “from URL” option.</p>
        <CopyField value={feed.url} label='Calendar link' variant='outline' />
      </div>
      <div className='flex flex-col gap-2 border-t border-line pt-4 md:flex-row'>
        <form action={createAction}>
          <input type='hidden' name='tripId' value={tripId} />
          <Button type='submit' variant='outline' disabled={creating} className='w-full'>
            {creating ? 'Making a new link…' : 'Make a new link'}
          </Button>
        </form>
        <form action={deleteAction}>
          <input type='hidden' name='tripId' value={tripId} />
          <Button type='submit' variant='outline' disabled={deleting} className='w-full'>
            {deleting ? 'Turning off…' : 'Turn off'}
          </Button>
        </form>
      </div>
      <p className='text-sm text-ink-muted'>The link is private to you. A new one stops the old one working.</p>
      <FormMessage state={message} />
    </div>
  )
}
