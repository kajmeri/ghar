'use client'

import { useActionState } from 'react'
import { MoneyInput } from '@/app/(app)/_components/ui/money-input'
import { Button } from '@/components/ui/button'
import { FormMessage } from '@/components/ui/field'
import { fieldError, IDLE } from '@/lib/actions/state'
import { simulatePriceAction } from '../actions'

/**
 * Development only. Sets what the fake price provider quotes for this booking, then runs the
 * same check the daily cron runs.
 */
export function SimulateForm({ bookingId, currency }: { bookingId: string; currency: string }) {
  const [state, formAction, pending] = useActionState(simulatePriceAction, IDLE)

  return (
    <form
      action={formAction}
      noValidate
      className='flex flex-col gap-4 rounded-card border border-dashed border-line bg-surface p-4 md:p-6'
    >
      <input type='hidden' name='bookingId' value={bookingId} />
      <div className='grid gap-4 md:grid-cols-2'>
        <MoneyInput
          id='simulate-price'
          name='priceCents'
          label='Price'
          hint='What both lookups find. Leave blank to quote what you paid.'
          currency={currency}
          error={fieldError(state, 'priceCents')}
        />
        <MoneyInput
          id='simulate-exact'
          name='exactCents'
          label='Verified price'
          hint='Leave blank to match. Set it to see a cached drop the exact quote doesn’t confirm.'
          currency={currency}
          error={fieldError(state, 'exactCents')}
        />
      </div>
      <div className='flex flex-col md:flex-row md:gap-6'>
        <Checkbox id='simulate-fail-cached' name='failCached' label='Cached lookup fails' />
        <Checkbox id='simulate-fail-exact' name='failExact' label='Verified lookup fails' />
      </div>
      <div className='flex flex-col gap-3 md:flex-row md:items-center'>
        <Button type='submit' variant='outline' disabled={pending}>
          {pending ? 'Checking…' : 'Set prices and run the check'}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  )
}

function Checkbox({ id, name, label }: { id: string; name: string; label: string }) {
  return (
    <label htmlFor={id} className='flex min-h-tap items-center gap-3 text-base'>
      <input id={id} name={name} type='checkbox' className='size-5 shrink-0 accent-ink' />
      {label}
    </label>
  )
}
