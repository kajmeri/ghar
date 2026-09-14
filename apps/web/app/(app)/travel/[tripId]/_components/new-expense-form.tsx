'use client'

import { createTransaction } from '@ghar/contracts'
import { parseMoneyInput } from '@ghar/core/money'
import { useState, type SyntheticEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { formText } from '@/lib/form'

/**
 * A charge typed straight onto the trip.
 *
 * The finances feature will bring these in from a bank connection and from parsed
 * receipts. This is what makes a trip's actual spend add up before that exists, and it is
 * also how the cash dinner no card will ever report gets counted.
 *
 * The amount is typed as what you spent, and stored negative, because money out is
 * negative everywhere else in the app. A refund is the one case that flips.
 */
export function NewExpenseForm({ tripId, today }: { tripId: string; today: string }) {
  const [open, setOpen] = useState(false)
  const [amountError, setAmountError] = useState<string | null>(null)

  const { mutate, pending, error } = useMutation(async (form: FormData) => {
    const spent = parseMoneyInput(formText(form, 'amount'))
    const isRefund = form.get('isRefund') !== null

    await api.request(createTransaction, {
      body: {
        tripId,
        postedOn: formText(form, 'postedOn'),
        description: formText(form, 'description'),
        merchant: formText(form, 'merchant') || null,
        amountCents: isRefund ? Math.abs(spent) : -Math.abs(spent),
      },
    })
    setOpen(false)
  })

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAmountError(null)
    const form = new FormData(event.currentTarget)

    try {
      if (parseMoneyInput(formText(form, 'amount')) === 0) {
        setAmountError('An amount of nothing is not a charge')
        return
      }
    } catch {
      setAmountError('Write the amount like 42.50')
      return
    }
    mutate(form)
  }

  if (!open) {
    return (
      <Button
        variant='outline'
        onClick={() => {
          setOpen(true)
        }}
      >
        Add a charge
      </Button>
    )
  }

  return (
    <Card className='p-4 md:p-5'>
      <form onSubmit={onSubmit} className='flex flex-col gap-4'>
        <p className='text-base font-semibold'>Add a charge</p>

        <div className='grid gap-4 md:grid-cols-2'>
          <Field label='What was it'>
            <Input name='description' required maxLength={200} autoFocus placeholder='Dinner at Ramiro' />
          </Field>
          <Field label='Where'>
            <Input name='merchant' maxLength={200} placeholder='Cervejaria Ramiro' />
          </Field>
          <Field label='Amount'>
            <Input name='amount' required inputMode='decimal' placeholder='42.50' />
          </Field>
          <Field label='Day'>
            <Input name='postedOn' type='date' required defaultValue={today} />
          </Field>
          <label className='flex min-h-tap items-center gap-2 md:col-span-2'>
            <input type='checkbox' name='isRefund' className='size-5 accent-ink' />
            <span className='text-sm'>This was a refund, not a charge</span>
          </label>
        </div>

        <FormError>{amountError ?? error}</FormError>

        <div className='flex gap-2'>
          <Button type='submit' disabled={pending}>
            {pending ? 'Saving…' : 'Save charge'}
          </Button>
          <Button
            type='button'
            variant='ghost'
            onClick={() => {
              setOpen(false)
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}
