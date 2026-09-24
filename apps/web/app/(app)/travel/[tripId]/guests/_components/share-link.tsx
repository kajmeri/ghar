'use client'

import type { TripLink } from '@ghar/contracts'
import { useActionState, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { FormMessage } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { IDLE } from '@/lib/actions/state'
import { createLinkAction, deleteLinkAction, setLinkApprovalAction } from '../actions'

/**
 * The trip's one shareable link. Off until someone turns it on; while it's on, anyone holding it
 * sees the invitation. A new link retires the old one, so a link that got passed too far around
 * can be taken back.
 */
export function ShareLink({ tripId, link }: { tripId: string; link: TripLink | null }) {
  const [createState, createAction, creating] = useActionState(createLinkAction, IDLE)
  const [approvalState, approvalAction, saving] = useActionState(setLinkApprovalAction, IDLE)
  const [deleteState, deleteAction, deleting] = useActionState(deleteLinkAction, IDLE)
  const message = [deleteState, approvalState, createState].find(state => state.status === 'error') ?? (link ? approvalState : deleteState)

  if (!link) {
    return (
      <div className='flex flex-col gap-3'>
        <p className='text-base text-ink-muted'>
          One link for a group chat. People who open it see the trip and who’s going, then answer. You let them in.
        </p>
        <form action={createAction}>
          <input type='hidden' name='tripId' value={tripId} />
          <Button type='submit' disabled={creating} className='w-full md:w-auto'>
            {creating ? 'Making a link…' : 'Make a link'}
          </Button>
        </form>
        <FormMessage state={createState.status === 'error' ? createState : message} />
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-4'>
      <CopyLink url={link.url} />
      <form action={approvalAction} className='flex flex-col gap-2'>
        <input type='hidden' name='tripId' value={tripId} />
        <input type='hidden' name='requiresApproval' value={link.requiresApproval ? 'false' : 'true'} />
        <p className='text-base'>
          {link.requiresApproval
            ? 'You let in people who come through the link.'
            : 'Anyone who answers through the link is let in straight away.'}
        </p>
        <Button type='submit' variant='outline' disabled={saving} className='w-full md:w-auto md:self-start'>
          {saving ? 'Saving…' : link.requiresApproval ? 'Let people in straight away' : 'Let people in myself'}
        </Button>
      </form>
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
            {deleting ? 'Turning off…' : 'Turn off the link'}
          </Button>
        </form>
      </div>
      <p className='text-sm text-ink-muted'>A new link stops the old one working. People already on the trip stay on it either way.</p>
      <FormMessage state={message} />
    </div>
  )
}

/** The clipboard isn't there over plain http or in some in-app browsers, so a failure selects the text. */
function CopyLink({ url }: { url: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const timer = setTimeout(() => {
      setState('idle')
    }, 2000)
    return () => {
      clearTimeout(timer)
    }
  }, [state])

  return (
    <div className='flex flex-col gap-2 md:flex-row'>
      <label htmlFor='trip-link' className='sr-only'>
        Trip link
      </label>
      <Input
        id='trip-link'
        readOnly
        value={url}
        onFocus={event => {
          event.currentTarget.select()
        }}
        className='text-sm text-ink-muted'
      />
      <Button
        type='button'
        className='md:w-32'
        onClick={() => {
          navigator.clipboard.writeText(url).then(
            () => {
              setState('copied')
            },
            () => {
              document.getElementById('trip-link')?.focus()
              setState('failed')
            }
          )
        }}
      >
        {state === 'copied' ? 'Copied' : 'Copy link'}
      </Button>
      <span role='status' className='sr-only'>
        {state === 'copied' ? 'Link copied' : state === 'failed' ? 'Couldn’t copy. The link is selected, so copy it yourself.' : ''}
      </span>
    </div>
  )
}
