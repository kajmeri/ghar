'use client'

import type { GuestResponseValue } from '@ghar/contracts'
import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FormMessage, Input } from '@/components/ui/field'
import { NativeSelect } from '@/components/ui/native-select'
import { fieldError, IDLE, submittedValue, type ActionState } from '@/lib/actions/state'

const CHOICES: { value: GuestResponseValue; label: string }[] = [
  { value: 'going', label: 'Going' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'not_going', label: 'Can’t go' },
]

const PILL =
  'flex min-h-tap items-center justify-center rounded-control border border-line bg-surface px-2 text-center text-base hover:border-ink/40 has-checked:border-ink has-checked:bg-ink has-checked:text-paper has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-surface'

const PARTY_SIZES = Array.from({ length: 10 }, (_, index) => index + 1)

/**
 * Going, Maybe or Can't go, and how many are coming. Signed out, it also takes an email, and its
 * action sends a sign-in link that comes back with the answer filled in.
 */
export function TripAnswerForm({
  action,
  hidden,
  signedIn,
  defaultResponse,
  defaultPartySize,
  needsName,
  defaultEmail,
  submitLabel,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>
  /** What the action needs besides the answer: the invitation's token, or the trip's id. */
  hidden: Record<string, string>
  signedIn: boolean
  defaultResponse: GuestResponseValue | null
  defaultPartySize: number
  needsName: boolean
  defaultEmail: string | null
  submitLabel: string
}) {
  const [state, formAction, pending] = useActionState(action, IDLE)
  const [response, setResponse] = useState<GuestResponseValue | null>(
    (submittedValue(state, 'response') as GuestResponseValue | undefined) ?? defaultResponse
  )

  if (state.status === 'success' && !signedIn) {
    return (
      <p role='status' className='text-base text-ink'>
        {state.message}
      </p>
    )
  }

  return (
    <form action={formAction} className='flex flex-col gap-5'>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type='hidden' name={name} value={value} />
      ))}
      <fieldset>
        <legend className='mb-1.5 text-sm font-medium text-ink'>Are you coming?</legend>
        <div className='grid grid-cols-3 gap-2'>
          {CHOICES.map(choice => (
            <label key={choice.value} className={PILL}>
              <input
                type='radio'
                name='response'
                value={choice.value}
                required
                checked={response === choice.value}
                onChange={() => {
                  setResponse(choice.value)
                }}
                className='sr-only'
              />
              {choice.label}
            </label>
          ))}
        </div>
        {fieldError(state, 'response') ? <p className='mt-1.5 text-sm text-negative'>Choose one.</p> : null}
      </fieldset>

      {response === 'not_going' ? (
        <input type='hidden' name='partySize' value='1' />
      ) : (
        <Field label='How many of you?' hint='You and anyone you’re bringing.' error={fieldError(state, 'partySize')}>
          <NativeSelect name='partySize' defaultValue={submittedValue(state, 'partySize') ?? String(defaultPartySize)}>
            {PARTY_SIZES.map(size => (
              <option key={size} value={size}>
                {size === 1 ? 'Just me' : String(size)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}

      {signedIn && needsName ? (
        <Field label='Your name' hint='So the household knows who answered.' error={fieldError(state, 'name')}>
          <Input name='name' autoComplete='name' required maxLength={100} defaultValue={submittedValue(state, 'name')} />
        </Field>
      ) : null}

      {signedIn ? null : (
        <Field label='Your email' hint='We’ll send a link to sign in. Open it and your answer is ready to send.' error={fieldError(state, 'email')}>
          <Input
            name='email'
            type='email'
            autoComplete='email'
            inputMode='email'
            required
            defaultValue={submittedValue(state, 'email') ?? defaultEmail ?? ''}
          />
        </Field>
      )}

      <Button type='submit' disabled={pending}>
        {pending ? (signedIn ? 'Sending…' : 'Sending link…') : signedIn ? submitLabel : 'Email me a sign-in link'}
      </Button>
      <FormMessage state={state} />
    </form>
  )
}
