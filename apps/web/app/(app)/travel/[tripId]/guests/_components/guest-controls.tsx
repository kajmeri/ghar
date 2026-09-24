'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { FormMessage } from '@/components/ui/field'
import { IDLE } from '@/lib/actions/state'
import { approveGuestAction, removeGuestAction } from '../actions'

/** Let in someone waiting, or take someone off. Turning down a request is the same as removing. */
export function GuestControls({ tripId, guestId, who, waiting }: { tripId: string; guestId: string; who: string; waiting: boolean }) {
  const [approveState, approveAction, approving] = useActionState(approveGuestAction, IDLE)
  const [removeState, removeAction, removing] = useActionState(removeGuestAction, IDLE)
  const message = removeState.status === 'error' ? removeState : approveState.status === 'error' ? approveState : IDLE

  return (
    <div className='flex flex-col gap-2 md:items-end'>
      <div className='flex gap-2'>
        {waiting ? (
          <form action={approveAction} className='flex-1 md:flex-none'>
            <input type='hidden' name='tripId' value={tripId} />
            <input type='hidden' name='guestId' value={guestId} />
            <Button type='submit' disabled={approving} className='w-full'>
              {approving ? 'Letting in…' : 'Let in'}
              <span className='sr-only'> {who}</span>
            </Button>
          </form>
        ) : null}
        <form action={removeAction} className='flex-1 md:flex-none'>
          <input type='hidden' name='tripId' value={tripId} />
          <input type='hidden' name='guestId' value={guestId} />
          <Button type='submit' variant='outline' disabled={removing} className='w-full'>
            {removing ? 'Removing…' : waiting ? 'Turn down' : 'Remove'}
            <span className='sr-only'> {who}</span>
          </Button>
        </form>
      </div>
      <FormMessage state={message} />
    </div>
  )
}
