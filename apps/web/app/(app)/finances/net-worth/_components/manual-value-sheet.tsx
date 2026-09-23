'use client'

import { addManualValue, type ManualAccount } from '@ghar/contracts'
import type { CalendarDate } from '@ghar/core/dates'
import { RefreshCw } from 'lucide-react'
import { useId, useState, type SyntheticEvent } from 'react'
import { CheckboxField } from '@/app/(app)/_components/ui/checkbox-field'
import { DateField } from '@/app/(app)/_components/ui/date-field'
import { MoneyInput } from '@/app/(app)/_components/ui/money-input'
import { Sheet, SheetClose } from '@/app/(app)/_components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Field, Textarea } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api, type BodyOf } from '@/lib/api/client'
import { formText } from '@/lib/form'

type Fields = NonNullable<BodyOf<typeof addManualValue>>

/** Records a new value. The old ones stay, so the account keeps its history. */
export function ManualValueSheet({ account, currency, today }: { account: ManualAccount; currency: string; today: CalendarDate }) {
  const formId = useId()
  const [open, setOpen] = useState(false)

  const save = useMutation<[Fields]>(async fields => {
    await api.request(addManualValue, { params: { manualAccountId: account.id }, body: fields })
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
      valueCents: Number(formText(data, 'valueCents')),
      source: data.get('estimate') === 'on' ? 'estimate' : 'manual',
      notes: formText(data, 'notes') || null,
    })
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <Button>
          <RefreshCw aria-hidden />
          Update value
        </Button>
      }
      title={`Update ${account.name}`}
      description='Adds a new value. The earlier ones stay in its history.'
      footer={
        <>
          <SheetClose asChild>
            <Button type='button' variant='outline'>
              Cancel
            </Button>
          </SheetClose>
          <Button type='submit' form={formId} disabled={save.pending}>
            {save.pending ? 'Saving…' : 'Save value'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className='flex flex-col gap-4'>
        <MoneyInput
          id={`${formId}-value`}
          name='valueCents'
          label={account.isLiability ? 'Still owed' : 'Worth'}
          hint={account.isLiability ? 'As the latest statement shows it.' : undefined}
          currency={currency}
          required
        />
        <DateField id={`${formId}-as-of`} name='asOf' label='As of' defaultValue={today} max={today} required />
        <CheckboxField
          name='estimate'
          label='It’s an estimate'
          hint='A home value from a listing site, say, rather than a statement.'
          defaultChecked={account.latestValue?.source === 'estimate'}
        />
        <Field label='Notes' hint='Where the figure came from.'>
          <Textarea name='notes' rows={2} maxLength={500} />
        </Field>
        <FormError>{save.error}</FormError>
      </form>
    </Sheet>
  )
}
