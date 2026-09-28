'use client'

import { useActionState, useId } from 'react'
import { YourNameField } from '@/app/_components/your-name-field'
import { Button } from '@/components/ui/button'
import { FormMessage } from '@/components/ui/field'
import { fieldError, IDLE, submittedValue } from '@/lib/actions/state'
import { joinHouseholdAction } from '../actions'

export function JoinHouseholdForm({
  invitationId,
  householdName,
  askName,
}: {
  invitationId: string
  householdName: string
  /** They haven't given a name yet. */
  askName: boolean
}) {
  const [state, formAction, pending] = useActionState(joinHouseholdAction, IDLE)
  const nameId = useId()

  return (
    <form action={formAction} className='flex flex-col gap-3'>
      <input type='hidden' name='invitationId' value={invitationId} />
      {askName ? (
        <YourNameField id={nameId} defaultValue={submittedValue(state, 'fullName')} error={fieldError(state, 'fullName')} />
      ) : null}
      <Button type='submit' disabled={pending}>
        {pending ? 'Joining…' : `Join ${householdName}`}
      </Button>
      <FormMessage state={state} />
    </form>
  )
}
