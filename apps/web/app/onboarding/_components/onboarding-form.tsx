'use client'

import { useActionState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { describedBy, Field, FormMessage } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid'
import { fieldError, IDLE, submittedValue } from '@/lib/actions/state'
import type { CurrencyOption } from '@/lib/households/options'
import { createHouseholdAction } from '../actions'

export function OnboardingForm({ timeZones, currencies }: { timeZones: string[]; currencies: CurrencyOption[] }) {
  const [state, formAction, pending] = useActionState(createHouseholdAction, IDLE)
  const formRef = useRef<HTMLFormElement>(null)
  useFocusFirstInvalid(formRef, state)
  const timeZoneRef = useRef<HTMLSelectElement>(null)
  const errors = {
    name: fieldError(state, 'name'),
    timezone: fieldError(state, 'timezone'),
    currency: fieldError(state, 'currency'),
  }

  // The server can't know the browser's zone, so preselect it once the form is on screen.
  useEffect(() => {
    const select = timeZoneRef.current
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (select && select.value === 'UTC' && timeZones.includes(detected)) select.value = detected
  }, [timeZones])

  return (
    <form ref={formRef} action={formAction} noValidate className='flex flex-col gap-5'>
      <Field id='name' label='Household name' hint='Everyone you invite will see this.' error={errors.name}>
        <Input
          id='name'
          name='name'
          required
          maxLength={80}
          autoComplete='off'
          defaultValue={submittedValue(state, 'name')}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={describedBy('name', errors.name, 'Everyone you invite will see this.')}
        />
      </Field>
      <Field id='timezone' label='Time zone' hint='Dates and reminders use it.' error={errors.timezone}>
        <NativeSelect
          ref={timeZoneRef}
          id='timezone'
          name='timezone'
          defaultValue={submittedValue(state, 'timezone') ?? 'UTC'}
          aria-invalid={Boolean(errors.timezone)}
          aria-describedby={describedBy('timezone', errors.timezone, 'Dates and reminders use it.')}
        >
          {timeZones.map(zone => (
            <option key={zone} value={zone}>
              {zone.replaceAll('_', ' ')}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id='currency' label='Currency' error={errors.currency}>
        <NativeSelect
          id='currency'
          name='currency'
          defaultValue={submittedValue(state, 'currency') ?? 'USD'}
          aria-invalid={Boolean(errors.currency)}
          aria-describedby={describedBy('currency', errors.currency)}
        >
          {currencies.map(({ code, label }) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Button type='submit' disabled={pending}>
        {pending ? 'Creating…' : 'Create household'}
      </Button>
      <FormMessage state={state} />
    </form>
  )
}
