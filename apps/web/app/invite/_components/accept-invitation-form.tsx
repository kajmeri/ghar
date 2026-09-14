'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { FormMessage } from '@/components/ui/field'
import { IDLE } from '@/lib/actions/state'
import { acceptInvitationAction } from '../actions'

export function AcceptInvitationForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(acceptInvitationAction, IDLE)

  return (
    <form action={formAction} className='flex flex-col gap-4'>
      <input type='hidden' name='token' value={token} />
      <Button type='submit' disabled={pending}>
        {pending ? 'Joining…' : 'Join household'}
      </Button>
      <FormMessage state={state} />
    </form>
  )
}
