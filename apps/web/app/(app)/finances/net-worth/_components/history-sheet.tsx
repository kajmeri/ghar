'use client'

import { saveNetWorthHistory } from '@ghar/contracts'
import type { CalendarDate } from '@ghar/core/dates'
import { Plus } from 'lucide-react'
import { useId, useState, type SyntheticEvent } from 'react'
import { DateField } from '@/app/(app)/_components/ui/date-field'
import { MoneyInput } from '@/app/(app)/_components/ui/money-input'
import { Sheet, SheetClose } from '@/app/(app)/_components/ui/sheet'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api, type BodyOf } from '@/lib/api/client'
import { formText } from '@/lib/form'

type Fields = NonNullable<BodyOf<typeof saveNetWorthHistory>>

/**
 * A day's totals typed in from old statements, for the time before tracking started. Banks won't
 * share past balances, so this is the only way the chart reaches back.
 */
export function HistorySheet({ currency, latestOn, variant = 'outline' }: { currency: string; latestOn: CalendarDate; variant?: 'default' | 'outline' }) {
  const formId = useId()
  const [open, setOpen] = useState(false)

  const save = useMutation<[Fields]>(async fields => {
    await api.request(saveNetWorthHistory, { body: fields })
    setOpen(false)
  })

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) save.clearError()
  }

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    save.mutate({
      asOf: formText(data, 'asOf'),
      assetsCents: Number(formText(data, 'assetsCents')),
      owedCents: Number(formText(data, 'owedCents') || '0'),
    })
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <Button variant={variant}>
          <Plus aria-hidden />
          Add a past day
        </Button>
      }
      title='Add a past day'
      description='Totals from old statements. A day you’ve already added is replaced.'
      footer={
        <>
          <SheetClose asChild>
            <Button type='button' variant='outline'>
              Cancel
            </Button>
          </SheetClose>
          <Button type='submit' form={formId} disabled={save.pending}>
            {save.pending ? 'Saving…' : 'Save day'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className='flex flex-col gap-4'>
        <DateField
          id={`${formId}-as-of`}
          name='asOf'
          label='Day'
          hint='Before tracking started. Days since then are already recorded.'
          max={latestOn}
          required
        />
        <MoneyInput
          id={`${formId}-assets`}
          name='assetsCents'
          label='Everything owned'
          hint='Accounts, the house, cars: all of it.'
          currency={currency}
          required
        />
        <MoneyInput
          id={`${formId}-owed`}
          name='owedCents'
          label='Everything owed'
          hint='Cards, loans and the mortgage, as positive amounts.'
          currency={currency}
        />
        <FormError>{save.error}</FormError>
      </form>
    </Sheet>
  )
}
