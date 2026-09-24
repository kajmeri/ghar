'use client'

import { Mail } from 'lucide-react'
import { useActionState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { describedBy, Field, FormMessage, Textarea } from '@/components/ui/field'
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid'
import { fieldError, IDLE, submittedValue } from '@/lib/actions/state'
import { inviteGuestsAction } from '../actions'

const HINT = 'Separate them with commas or new lines. Each person gets their own link.'

export function InviteGuestsForm({ tripId }: { tripId: string }) {
  const [state, formAction, pending] = useActionState(inviteGuestsAction, IDLE)
  const formRef = useRef<HTMLFormElement>(null)
  useFocusFirstInvalid(formRef, state)
  const error = fieldError(state, 'emails')

  // Clear the box once the invitations are out, so the next batch starts empty.
  useEffect(() => {
    if (state.status === 'success') formRef.current?.reset()
  }, [state])

  return (
    <form ref={formRef} action={formAction} noValidate className='flex flex-col gap-4'>
      <input type='hidden' name='tripId' value={tripId} />
      <Field id='guest-emails' label='Email addresses' hint={HINT} error={error}>
        <Textarea
          id='guest-emails'
          name='emails'
          rows={3}
          autoComplete='off'
          inputMode='email'
          defaultValue={submittedValue(state, 'emails')}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy('guest-emails', error, HINT)}
        />
      </Field>
      <div className='flex flex-col gap-3 md:flex-row md:items-center'>
        <Button type='submit' disabled={pending}>
          <Mail aria-hidden />
          {pending ? 'Sending…' : 'Send invitations'}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  )
}
