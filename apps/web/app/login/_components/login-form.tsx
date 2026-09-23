'use client'

import { useActionState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { describedBy, Field, FormMessage } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid'
import { fieldError, IDLE, submittedValue } from '@/lib/actions/state'
import { requestSignInLink } from '../actions'

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(requestSignInLink, IDLE)
  const formRef = useRef<HTMLFormElement>(null)
  useFocusFirstInvalid(formRef, state)
  const emailError = fieldError(state, 'email')

  return (
    <form ref={formRef} action={formAction} noValidate className='flex flex-col gap-4'>
      {next ? <input type='hidden' name='next' value={next} /> : null}
      <Field id='email' label='Email' error={emailError}>
        <Input
          id='email'
          name='email'
          type='email'
          autoComplete='email'
          inputMode='email'
          required
          defaultValue={submittedValue(state, 'email')}
          aria-invalid={Boolean(emailError)}
          aria-describedby={describedBy('email', emailError)}
        />
      </Field>
      <Button type='submit' disabled={pending}>
        {pending ? 'Sending…' : 'Email me a sign-in link'}
      </Button>
      <FormMessage state={state} />
    </form>
  )
}
