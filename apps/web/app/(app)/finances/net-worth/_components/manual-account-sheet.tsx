'use client'

import { createManualAccount, manualAccountKindSchema, updateManualAccount, type ManualAccount } from '@ghar/contracts'
import type { CalendarDate } from '@ghar/core/dates'
import { Pencil, Plus } from 'lucide-react'
import { useId, useState, type SyntheticEvent } from 'react'
import { CheckboxField } from '@/app/(app)/_components/ui/checkbox-field'
import { DateField } from '@/app/(app)/_components/ui/date-field'
import { MoneyInput } from '@/app/(app)/_components/ui/money-input'
import { Sheet, SheetClose } from '@/app/(app)/_components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { NativeSelect } from '@/components/ui/native-select'
import { useMutation } from '@/hooks/use-mutation'
import { api, type BodyOf } from '@/lib/api/client'
import { formText } from '@/lib/form'
import { MANUAL_KIND_GROUPS, REMINDER_OPTIONS } from '@/lib/networth/display'

type CreateFields = NonNullable<BodyOf<typeof createManualAccount>>
type UpdateFields = NonNullable<BodyOf<typeof updateManualAccount>>

/**
 * Adds something Ghar can't connect to (the house, a car, a 401k elsewhere) or edits one. A new
 * account can take its first value here; later values go through "Update value" so the history stays.
 */
export function ManualAccountSheet({ account, currency, today }: { account?: ManualAccount; currency: string; today: CalendarDate }) {
  const formId = useId()
  const [open, setOpen] = useState(false)

  const save = useMutation<[CreateFields | UpdateFields]>(async fields => {
    if (account) {
      await api.request(updateManualAccount, { params: { manualAccountId: account.id }, body: fields as UpdateFields })
    } else {
      await api.request(createManualAccount, { body: fields as CreateFields })
    }
    setOpen(false)
  })

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) save.clearError()
  }

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const kind = manualAccountKindSchema.safeParse(formText(data, 'kind'))
    if (!kind.success) return
    const reminder = formText(data, 'reminderCadenceMonths')
    const common = {
      name: formText(data, 'name'),
      kind: kind.data,
      notes: formText(data, 'notes') || null,
      reminderCadenceMonths: reminder === '' ? null : Number(reminder),
    }
    if (account) {
      save.mutate({ ...common, archived: data.get('archived') === 'on' })
      return
    }
    const value = formText(data, 'valueCents')
    save.mutate({
      ...common,
      value:
        value === ''
          ? null
          : {
              asOf: formText(data, 'asOf') || today,
              valueCents: Number(value),
              source: data.get('estimate') === 'on' ? 'estimate' : 'manual',
              notes: null,
            },
    })
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        account ? (
          <Button variant='outline'>
            <Pencil aria-hidden />
            Edit account
          </Button>
        ) : (
          <Button>
            <Plus aria-hidden />
            Add an account
          </Button>
        )
      }
      title={account ? 'Edit account' : 'Add an account'}
      description={account ? undefined : 'For what Ghar can’t connect to: the house, a car, a retirement account somewhere else.'}
      footer={
        <>
          <SheetClose asChild>
            <Button type='button' variant='outline'>
              Cancel
            </Button>
          </SheetClose>
          <Button type='submit' form={formId} disabled={save.pending}>
            {save.pending ? 'Saving…' : account ? 'Save changes' : 'Save account'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className='flex flex-col gap-4'>
        <Field label='Name'>
          <Input name='name' required maxLength={80} defaultValue={account?.name} placeholder='The house' autoComplete='off' />
        </Field>

        <Field label='What it is'>
          <NativeSelect name='kind' required defaultValue={account?.kind ?? ''}>
            <option value='' disabled>
              Pick one
            </option>
            {MANUAL_KIND_GROUPS.map(group => (
              <optgroup key={group.label} label={group.label}>
                {group.kinds.map(kind => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </NativeSelect>
        </Field>

        {account ? null : (
          <>
            <MoneyInput
              id={`${formId}-value`}
              name='valueCents'
              label='What it’s worth, or what’s owed'
              hint='Leave it empty to add it later. It counts toward net worth once it has a value.'
              currency={currency}
            />
            <DateField id={`${formId}-as-of`} name='asOf' label='As of' defaultValue={today} max={today} />
            <CheckboxField name='estimate' label='It’s an estimate' hint='A home value from a listing site, say, rather than a statement.' />
          </>
        )}

        <Field label='Remind me to update it' hint='The daily email asks once the value is this old.'>
          <NativeSelect name='reminderCadenceMonths' defaultValue={account?.reminderCadenceMonths?.toString() ?? ''}>
            {REMINDER_OPTIONS.map(option => (
              <option key={option.label} value={option.value?.toString() ?? ''}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label='Notes'>
          <Textarea name='notes' rows={3} maxLength={500} defaultValue={account?.notes ?? undefined} />
        </Field>

        {account ? (
          <CheckboxField
            name='archived'
            label='Archived'
            hint='Stops counting toward today’s net worth, for something sold or paid off. Its history stays.'
            defaultChecked={account.archivedAt !== null}
          />
        ) : null}

        <FormError>{save.error}</FormError>
      </form>
    </Sheet>
  )
}
