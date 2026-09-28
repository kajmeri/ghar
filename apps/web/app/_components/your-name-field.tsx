'use client'

import { describedBy, Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

const HINT = 'How everyone in the household sees you.'

/**
 * Asked on the way in, so nobody in the household shows up as "Member" and a code. Sends
 * `fullName`. Pass an `id` when more than one form on the page asks.
 */
export function YourNameField({ id = 'fullName', defaultValue, error }: { id?: string; defaultValue?: string; error?: string }) {
  return (
    <Field id={id} label='Your name' hint={HINT} error={error}>
      <Input
        id={id}
        name='fullName'
        required
        maxLength={100}
        autoComplete='name'
        defaultValue={defaultValue}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy(id, error, HINT)}
      />
    </Field>
  )
}
