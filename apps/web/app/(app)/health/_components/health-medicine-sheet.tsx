'use client'

import {
  createHealthMedicine,
  deleteHealthMedicine,
  MEDICINE_DOSE_MAX,
  MEDICINE_NAME_MAX,
  stopHealthMedicine,
  updateHealthMedicine,
  type HealthMedicine,
} from '@ghar/contracts'
import type { CalendarDate } from '@ghar/core/dates'
import { leadTimePhrase } from '@ghar/core/expiries'
import { HEALTH_EARLIEST_DATE } from '@ghar/core/health'
import { Trash2 } from 'lucide-react'
import { useId, useState, type ReactElement, type SyntheticEvent } from 'react'
import { ConfirmDialog } from '@/app/(app)/_components/ui/confirm-dialog'
import { DateField } from '@/app/(app)/_components/ui/date-field'
import { Sheet, SheetClose } from '@/app/(app)/_components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { NativeSelect } from '@/components/ui/native-select'
import { useMutation } from '@/hooks/use-mutation'
import { api, type BodyOf } from '@/lib/api/client'
import { formText } from '@/lib/form'
import { MEDICINE_SUPPLY_OPTIONS } from '@/lib/health/display'
import type { HealthFormOptions } from '@/lib/health/service'

/**
 * Adds a medicine for one person, or edits one. A current one can be stopped from here, which keeps
 * it as history; a stopped one shows the day it stopped, and clearing that starts it again.
 */
export function HealthMedicineSheet({
  personId,
  personName,
  medicine,
  options,
  today,
  open: controlledOpen,
  onClose,
  trigger,
}: {
  personId: string
  /** "You" or their name. */
  personName: string
  medicine?: HealthMedicine
  options: HealthFormOptions
  today: CalendarDate
  open?: boolean
  onClose?: () => void
  trigger?: ReactElement
}) {
  const formId = useId()
  const [ownOpen, setOwnOpen] = useState(false)
  const open = controlledOpen ?? ownOpen
  const stopped = medicine !== undefined && medicine.stoppedOn !== null

  const close = () => {
    setOwnOpen(false)
    onClose?.()
  }

  const save = useMutation(async (fields: BodyOf<typeof createHealthMedicine>) => {
    if (medicine) await api.request(updateHealthMedicine, { params: { medicineId: medicine.id }, body: fields })
    else await api.request(createHealthMedicine, { body: fields })
    close()
  })
  const stop = useMutation(async () => {
    if (!medicine) return
    await api.request(stopHealthMedicine, { params: { medicineId: medicine.id } })
    close()
  })
  const remove = useMutation(async () => {
    if (!medicine) return
    await api.request(deleteHealthMedicine, { params: { medicineId: medicine.id } })
    close()
  })
  const pending = save.pending || stop.pending || remove.pending

  const onSubmit = (submitted: SyntheticEvent<HTMLFormElement>) => {
    submitted.preventDefault()
    const data = new FormData(submitted.currentTarget)
    const supply = formText(data, 'supplyDays')
    const stoppedOn = stopped ? formText(data, 'stoppedOn') || null : null
    save.mutate({
      personId,
      name: formText(data, 'name'),
      dose: formText(data, 'dose') || null,
      contactId: formText(data, 'contactId') || null,
      startedOn: formText(data, 'startedOn') || null,
      stoppedOn,
      // A stopped one has no refill date to keep; one started again picks it up from the form.
      refillBy: stoppedOn === null ? formText(data, 'refillBy') || null : null,
      supplyDays: supply === '' ? null : Number(supply),
      note: formText(data, 'note') || null,
    })
  }

  const current = medicine?.supplyDays ?? null
  const supplies =
    current === null || MEDICINE_SUPPLY_OPTIONS.includes(current)
      ? MEDICINE_SUPPLY_OPTIONS
      : [...MEDICINE_SUPPLY_OPTIONS, current].toSorted((a, b) => a - b)
  const forWhom = personName === 'You' ? '' : ` for ${personName}`
  const hiddenContact = medicine?.contactId != null && !options.contacts.some(contact => contact.id === medicine.contactId)

  return (
    <Sheet
      open={open}
      onOpenChange={next => {
        if (next) {
          setOwnOpen(true)
          return
        }
        save.clearError()
        stop.clearError()
        remove.clearError()
        close()
      }}
      trigger={trigger}
      title={medicine ? 'Edit medicine' : 'Add a medicine'}
      description={
        stopped
          ? `Stopped, and kept as history${forWhom}. Clear the stop date to start it again.`
          : `Something taken now${forWhom}. Add a refill date and Ghar reminds you a week before.`
      }
      footer={
        <>
          <SheetClose asChild>
            <Button type='button' variant='outline'>
              Cancel
            </Button>
          </SheetClose>
          <Button type='submit' form={formId} disabled={pending}>
            {save.pending ? 'Saving…' : medicine ? 'Save changes' : 'Save medicine'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className='flex flex-col gap-4'>
        <Field label='Name'>
          <Input name='name' required maxLength={MEDICINE_NAME_MAX} defaultValue={medicine?.name} placeholder='Cetirizine' />
        </Field>

        <Field label='Dose' hint='As the label says it.'>
          <Input name='dose' maxLength={MEDICINE_DOSE_MAX} defaultValue={medicine?.dose ?? undefined} placeholder='10 mg once a day' />
        </Field>

        {options.contacts.length > 0 && !hiddenContact ? (
          <Field label='Prescribed by'>
            <NativeSelect name='contactId' defaultValue={medicine?.contactId ?? ''}>
              <option value=''>Nobody in particular</option>
              {options.contacts.map(contact => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : hiddenContact ? (
          <input type='hidden' name='contactId' value={medicine.contactId ?? ''} />
        ) : null}

        <div className='grid gap-3 sm:grid-cols-2'>
          <DateField
            id={`${formId}-started`}
            name='startedOn'
            label='Started'
            min={HEALTH_EARLIEST_DATE}
            defaultValue={medicine?.startedOn ?? undefined}
          />
          {stopped ? (
            <DateField
              id={`${formId}-stopped`}
              name='stoppedOn'
              label='Stopped'
              min={HEALTH_EARLIEST_DATE}
              max={today}
              defaultValue={medicine.stoppedOn ?? undefined}
            />
          ) : (
            <DateField
              id={`${formId}-refill`}
              name='refillBy'
              label='Refill by'
              min={HEALTH_EARLIEST_DATE}
              defaultValue={medicine?.refillBy ?? undefined}
            />
          )}
        </div>

        <Field label='A refill lasts' hint='So “Refilled” can set the next date for you.'>
          <NativeSelect name='supplyDays' defaultValue={current === null ? '' : String(current)}>
            <option value=''>Not tracked</option>
            {supplies.map(days => (
              <option key={days} value={days}>
                {leadTimePhrase(days)}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label='Note' hint='Keep it short, like “with food”.'>
          <Textarea name='note' rows={2} maxLength={1000} defaultValue={medicine?.note ?? undefined} />
        </Field>

        <FormError>{save.error}</FormError>

        {medicine ? (
          <div className='flex flex-col items-start gap-2 border-t border-line pt-4'>
            <div className='flex flex-wrap gap-2'>
              {stopped ? null : (
                <Button
                  type='button'
                  variant='outline'
                  disabled={pending}
                  onClick={() => {
                    stop.mutate()
                  }}
                >
                  {stop.pending ? 'Stopping…' : 'Stop taking it'}
                </Button>
              )}
              <ConfirmDialog
                trigger={
                  <Button type='button' variant='outline' disabled={pending}>
                    <Trash2 aria-hidden />
                    {remove.pending ? 'Deleting…' : 'Delete medicine'}
                  </Button>
                }
                title='Delete this medicine?'
                description={
                  stopped
                    ? 'It comes off the history for good.'
                    : 'It comes off for good, with no history kept. To keep it as history, stop taking it instead.'
                }
                confirmLabel='Delete'
                tone='destructive'
                onConfirm={() => {
                  remove.mutate()
                }}
              />
            </div>
            <FormError>{stop.error ?? remove.error}</FormError>
          </div>
        ) : null}
      </form>
    </Sheet>
  )
}
