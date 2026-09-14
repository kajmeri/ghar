'use client'

import { createMaintenanceTask, updateMaintenanceTask, type MaintenanceTask } from '@ghar/contracts'
import { initialNextDueOn } from '@ghar/core/home'
import { Pencil, Plus } from 'lucide-react'
import { useId, useState, type SyntheticEvent } from 'react'
import { DateField } from '@/app/(app)/_components/ui/date-field'
import { Sheet, SheetClose } from '@/app/(app)/_components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { NativeSelect } from '@/components/ui/native-select'
import { useMutation } from '@/hooks/use-mutation'
import { api, type BodyOf } from '@/lib/api/client'
import { formText } from '@/lib/form'
import type { AssetOption } from '../../documents/_components/document-sheet'

export interface MemberOption {
  userId: string
  name: string
}

export interface ContactOption {
  id: string
  name: string
  role: string | null
}

type Fields = NonNullable<BodyOf<typeof updateMaintenanceTask>>

function wholeNumber(text: string): number | null {
  return text === '' ? null : Number(text)
}

/** Adds a recurring or one-off job, or edits one. */
export function MaintenanceSheet({
  task,
  assets,
  members,
  contacts,
  assetId,
  variant = 'default',
}: {
  /** Edits this job. Leave it out to add one. */
  task?: MaintenanceTask
  assets: AssetOption[]
  members: MemberOption[]
  contacts: ContactOption[]
  /** Starts a new job on this asset. */
  assetId?: string
  variant?: 'default' | 'outline'
}) {
  const formId = useId()
  const [open, setOpen] = useState(false)

  const save = useMutation<[Fields]>(async fields => {
    if (task) {
      await api.request(updateMaintenanceTask, { params: { taskId: task.id }, body: fields })
    } else {
      await api.request(createMaintenanceTask, { body: fields })
    }
    setOpen(false)
  })

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) save.clearError()
  }

  // A due date that simply follows from the cadence stays empty, so changing the last-done date
  // or the cadence moves it. Only a date someone set by hand is shown as one.
  const worked = task ? initialNextDueOn({ cadenceMonths: task.cadenceMonths, lastDoneOn: task.lastDoneOn, nextDueOn: null }) : null
  const nextDueDefault = task?.nextDueOn && task.nextDueOn !== worked ? task.nextDueOn : undefined

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    save.mutate({
      title: formText(data, 'title'),
      assetId: formText(data, 'assetId') || null,
      cadenceMonths: wholeNumber(formText(data, 'cadenceMonths')),
      cadenceMiles: wholeNumber(formText(data, 'cadenceMiles')),
      lastDoneOn: formText(data, 'lastDoneOn') || null,
      nextDueOn: formText(data, 'nextDueOn') || null,
      assignedUserId: formText(data, 'assignedUserId') || null,
      vendorContactId: formText(data, 'vendorContactId') || null,
      instructions: formText(data, 'instructions') || null,
    })
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        task ? (
          <Button variant='outline'>
            <Pencil aria-hidden />
            Edit job
          </Button>
        ) : (
          <Button variant={variant}>
            <Plus aria-hidden />
            Add a job
          </Button>
        )
      }
      title={task ? 'Edit job' : 'Add a job'}
      description={task ? undefined : 'Something that needs doing again and again, like changing a filter, or just once.'}
      footer={
        <>
          <SheetClose asChild>
            <Button type='button' variant='outline'>
              Cancel
            </Button>
          </SheetClose>
          <Button type='submit' form={formId} disabled={save.pending}>
            {save.pending ? 'Saving…' : task ? 'Save changes' : 'Save job'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className='flex flex-col gap-4'>
        <Field label='What needs doing'>
          <Input name='title' required maxLength={120} defaultValue={task?.title} placeholder='Replace the furnace filter' />
        </Field>

        {assets.length > 0 ? (
          <Field label='For'>
            <NativeSelect name='assetId' defaultValue={task?.assetId ?? assetId ?? ''}>
              <option value=''>The house in general</option>
              {assets.map(asset => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}

        <Field label='Every how many months' hint='Leave it empty for a job that happens once.'>
          <Input
            name='cadenceMonths'
            type='number'
            inputMode='numeric'
            min={1}
            max={120}
            step={1}
            defaultValue={task?.cadenceMonths ?? undefined}
          />
        </Field>

        <Field label='Or every how many miles' hint='For a car. The date still rolls forward by months.'>
          <Input
            name='cadenceMiles'
            type='number'
            inputMode='numeric'
            min={1}
            max={500000}
            step={1}
            defaultValue={task?.cadenceMiles ?? undefined}
          />
        </Field>

        <div className='grid grid-cols-2 gap-3'>
          <DateField id={`${formId}-last`} name='lastDoneOn' label='Last done' defaultValue={task?.lastDoneOn ?? undefined} />
          <DateField id={`${formId}-next`} name='nextDueOn' label='Next due' defaultValue={nextDueDefault} />
        </div>
        <p className='-mt-2 text-sm text-ink-muted'>Leave next due empty and Ghar works it out from the last time it was done.</p>

        {members.length > 1 ? (
          <Field label='Whose job it is'>
            <NativeSelect name='assignedUserId' defaultValue={task?.assignedUserId ?? ''}>
              <option value=''>Anyone</option>
              {members.map(member => (
                <option key={member.userId} value={member.userId}>
                  {member.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}

        {contacts.length > 0 ? (
          <Field label='Who to call'>
            <NativeSelect name='vendorContactId' defaultValue={task?.vendor?.id ?? ''}>
              <option value=''>No one</option>
              {contacts.map(contact => (
                <option key={contact.id} value={contact.id}>
                  {contact.role ? `${contact.name} (${contact.role})` : contact.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}

        <Field label='How to do it' hint='The filter size, where the shutoff is, what to buy.'>
          <Textarea name='instructions' rows={4} maxLength={4000} defaultValue={task?.instructions ?? undefined} />
        </Field>

        <FormError>{save.error}</FormError>
      </form>
    </Sheet>
  )
}
