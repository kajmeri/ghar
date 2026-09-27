'use client'

import { Mail } from 'lucide-react'
import { useActionState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { describedBy, Field, FormMessage } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid'
import { fieldError, IDLE, submittedValue } from '@/lib/actions/state'
import { inviteAction, type InviteState } from '../actions'
import { UnsentInvitation } from './unsent-invitation'

export interface RoleOption {
  value: string
  label: string
  description: string
}

export function InviteForm({ roles }: { roles: RoleOption[] }) {
  const [state, formAction, pending] = useActionState<InviteState, FormData>(inviteAction, IDLE)
  const formRef = useRef<HTMLFormElement>(null)
  const formState = state.status === 'unsent' ? IDLE : state
  useFocusFirstInvalid(formRef, formState)
  const errors = { email: fieldError(formState, 'email'), role: fieldError(formState, 'role') }

  return (
    <form
      ref={formRef}
      action={formAction}
      noValidate
      className='flex flex-col gap-4 rounded-card border border-line bg-surface p-4 md:p-6'
    >
      <div className='grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem]'>
        <Field id='invite-email' label='Email' error={errors.email}>
          <Input
            id='invite-email'
            name='email'
            type='email'
            inputMode='email'
            autoComplete='off'
            required
            defaultValue={submittedValue(formState, 'email')}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={describedBy('invite-email', errors.email)}
          />
        </Field>
        <Field id='invite-role' label='Role' error={errors.role}>
          <NativeSelect
            id='invite-role'
            name='role'
            defaultValue={submittedValue(formState, 'role') ?? roles[0]?.value}
            aria-invalid={Boolean(errors.role)}
            aria-describedby={describedBy('invite-role', errors.role)}
          >
            {roles.map(role => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <dl className='flex flex-col gap-1 text-sm'>
        {roles.map(role => (
          <div key={role.value}>
            <dt className='inline font-medium'>{role.label}: </dt>
            <dd className='inline text-ink-muted'>{role.description}</dd>
          </div>
        ))}
      </dl>
      <div className='flex flex-col gap-3 md:flex-row md:items-center'>
        <Button type='submit' disabled={pending}>
          <Mail aria-hidden />
          {pending ? 'Sending…' : 'Send invitation'}
        </Button>
        <FormMessage state={formState} />
      </div>
      {state.status === 'unsent' ? <UnsentInvitation message={state.message} link={state.link} /> : null}
    </form>
  )
}
