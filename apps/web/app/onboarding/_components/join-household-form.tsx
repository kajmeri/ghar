'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { FormMessage } from '@/components/ui/field'
import { IDLE } from '@/lib/actions/state'
import { joinHouseholdAction } from '../actions'

export function JoinHouseholdForm({ invitationId, householdName }: { invitationId: string; householdName: string }) {
  const [state, formAction, pending] = useActionState(joinHouseholdAction, IDLE)

  return (
    <form action={formAction} className='flex flex-col gap-3'>
      <input type='hidden' name='invitationId' value={invitationId} />
      <Button type='submit' disabled={pending}>
        {pending ? 'Joining…' : `Join ${householdName}`}
      </Button>
      <FormMessage state={state} />
    </form>
  )
}
