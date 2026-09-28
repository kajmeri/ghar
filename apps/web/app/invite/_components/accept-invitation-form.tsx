'use client'

import { useActionState } from 'react'
import { YourNameField } from '@/app/_components/your-name-field'
import { Button } from '@/components/ui/button'
import { FormMessage } from '@/components/ui/field'
import { fieldError, IDLE, submittedValue } from '@/lib/actions/state'
import { acceptInvitationAction } from '../actions'

/** `askName` when they haven't given a name yet. */
export function AcceptInvitationForm({ token, askName }: { token: string; askName: boolean }) {
  const [state, formAction, pending] = useActionState(acceptInvitationAction, IDLE)

  return (
    <form action={formAction} className='flex flex-col gap-4'>
      <input type='hidden' name='token' value={token} />
      {askName ? <YourNameField defaultValue={submittedValue(state, 'fullName')} error={fieldError(state, 'fullName')} /> : null}
      <Button type='submit' disabled={pending}>
        {pending ? 'Joining…' : 'Join household'}
      </Button>
      <FormMessage state={state} />
    </form>
  )
}
