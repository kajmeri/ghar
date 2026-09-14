'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { FormMessage } from '@/components/ui/field'
import { IDLE } from '@/lib/actions/state'
import { inviteAction, revokeInvitationAction } from '../actions'

/** Resend replaces the invitation with a fresh link and expiry; revoke deletes it. */
export function InvitationControls({ invitationId, email, role }: { invitationId: string; email: string; role: string }) {
  const [resendState, resendAction, resending] = useActionState(inviteAction, IDLE)
  const [revokeState, revokeAction, revoking] = useActionState(revokeInvitationAction, IDLE)
  const message = revokeState.status === 'error' ? revokeState : resendState

  return (
    <div className='flex flex-col gap-2 md:items-end'>
      <div className='flex gap-2'>
        <form action={resendAction} className='flex-1 md:flex-none'>
          <input type='hidden' name='email' value={email} />
          <input type='hidden' name='role' value={role} />
          <Button type='submit' variant='outline' disabled={resending} className='w-full'>
            {resending ? 'Sending…' : 'Resend'}
            <span className='sr-only'> invitation to {email}</span>
          </Button>
        </form>
        <form action={revokeAction} className='flex-1 md:flex-none'>
          <input type='hidden' name='invitationId' value={invitationId} />
          <Button type='submit' variant='outline' disabled={revoking} className='w-full'>
            {revoking ? 'Revoking…' : 'Revoke'}
            <span className='sr-only'> invitation to {email}</span>
          </Button>
        </form>
      </div>
      <FormMessage state={message} />
    </div>
  )
}
