'use client'

import { completeMaintenanceTask } from '@ghar/contracts'
import type { CalendarDate } from '@ghar/core/dates'
import { NotebookPen } from 'lucide-react'
import { useId, useState, type SyntheticEvent } from 'react'
import { DateField } from '@/app/(app)/_components/ui/date-field'
import { MoneyInput } from '@/app/(app)/_components/ui/money-input'
import { Sheet, SheetClose } from '@/app/(app)/_components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Field, Textarea } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api, type BodyOf } from '@/lib/api/client'
import { formText } from '@/lib/form'

type Fields = NonNullable<BodyOf<typeof completeMaintenanceTask>>

/** Mark done with the date, the cost and what was done. For when the plumber came, not a filter swap. */
export function LogCompletionSheet({ taskId, today, currency }: { taskId: string; today: CalendarDate; currency: string }) {
  const formId = useId()
  const [open, setOpen] = useState(false)

  const save = useMutation<[Fields]>(async fields => {
    await api.request(completeMaintenanceTask, { params: { taskId }, body: fields })
    setOpen(false)
  })

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) save.clearError()
  }

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const cost = formText(data, 'costCents')
    save.mutate({
      completedOn: formText(data, 'completedOn') || today,
      costCents: cost === '' ? null : Number(cost),
      notes: formText(data, 'notes') || null,
    })
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <Button variant='outline'>
          <NotebookPen aria-hidden />
          Log with details
        </Button>
      }
      title='Log it done'
      description='An earlier date fills in the history without moving when it’s next due.'
      footer={
        <>
          <SheetClose asChild>
            <Button type='button' variant='outline'>
              Cancel
            </Button>
          </SheetClose>
          <Button type='submit' form={formId} disabled={save.pending}>
            {save.pending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className='flex flex-col gap-4'>
        <DateField id={`${formId}-date`} name='completedOn' label='Done on' defaultValue={today} max={today} required />
        <MoneyInput id={`${formId}-cost`} name='costCents' label='Cost' currency={currency} />
        <Field label='Notes'>
          <Textarea name='notes' rows={4} maxLength={4000} placeholder='What was done, parts used, who came' />
        </Field>
        <FormError>{save.error}</FormError>
      </form>
    </Sheet>
  )
}
