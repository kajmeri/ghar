'use client'

import type { TripLink } from '@ghar/contracts'
import { useActionState, useState } from 'react'
import { ConfirmDialog } from '@/app/(app)/_components/ui/confirm-dialog'
import { CopyField } from '@/app/_components/copy-field'
import { Button } from '@/components/ui/button'
import { FormMessage } from '@/components/ui/field'
import { IDLE, type ActionState } from '@/lib/actions/state'
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
  // Making a new link leaves this component on screen, so its dialog closes itself once the new
  // link is made: it stays open from the state it was opened on until a success replaces it.
  const [newLinkFrom, setNewLinkFrom] = useState<ActionState | null>(null)
  const confirmingNewLink = newLinkFrom !== null && !(createState !== newLinkFrom && createState.status === 'success')

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
      <CopyField value={link.url} label='Trip link' />
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
        <ConfirmDialog
          open={confirmingNewLink}
          onOpenChange={next => {
            setNewLinkFrom(next ? createState : null)
          }}
          trigger={
            <Button type='button' variant='outline' disabled={creating} className='w-full md:w-auto'>
              {creating ? 'Making a new link…' : 'Make a new link'}
            </Button>
          }
          title='Make a new link?'
          description='The link you’ve shared stops working, so anyone who hasn’t answered yet will need the new one. People already on the trip stay on it.'
          confirmLabel='Make a new link'
          pendingLabel='Making a new link…'
          formAction={createAction}
          fields={{ tripId }}
          pending={creating}
          error={createState.status === 'error' ? <FormMessage state={createState} /> : undefined}
        />
        <ConfirmDialog
          trigger={
            <Button type='button' variant='outline' disabled={deleting} className='w-full md:w-auto'>
              {deleting ? 'Turning off…' : 'Turn off the link'}
            </Button>
          }
          title='Turn off the link?'
          description='Nobody new can answer through it. People already on the trip stay on it, and you can make a new link any time.'
          confirmLabel='Turn off the link'
          pendingLabel='Turning off…'
          tone='destructive'
          formAction={deleteAction}
          fields={{ tripId }}
          pending={deleting}
          error={deleteState.status === 'error' ? <FormMessage state={deleteState} /> : undefined}
        />
      </div>
      <p className='text-sm text-ink-muted'>A new link stops the old one working. People already on the trip stay on it either way.</p>
      <FormMessage state={message} />
    </div>
  )
}
