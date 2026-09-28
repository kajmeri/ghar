'use client'

import { createSlot, updateSlot, type ItinerarySlot } from '@ghar/contracts'
import { addCalendarDays, formatCalendarDate, instantInTimeZone, wallClockTimeInTimeZone } from '@ghar/core/dates'
import { SLOT_BANDS, SLOT_BAND_LABELS, SLOT_KINDS, SLOT_KIND_LABELS, bandForTime, type SlotBand, type SlotKind } from '@ghar/core/itinerary'
import { useState, type SyntheticEvent } from 'react'
import { Sheet, SheetClose } from '@/app/(app)/_components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { formText } from '@/lib/form'
import { useItinerary } from './itinerary-context'

export const isBand = (value: string): value is SlotBand => (SLOT_BANDS as readonly string[]).includes(value)
const isKind = (value: string): value is SlotKind => (SLOT_KINDS as readonly string[]).includes(value)

/**
 * A slot is a time on a day that something will fill: "Dinner", "Tuesday afternoon". A part of
 * the day is enough; a time, once there is one, sets the part of the day for you.
 */
export function SlotFormSheet({ slot, day, band }: { slot?: ItinerarySlot; day?: string; band?: SlotBand }) {
  const { tripId, timeZone, days, today, closeSheet, setExpanded } = useItinerary()
  const [chosenBand, setChosenBand] = useState<SlotBand>(slot?.band ?? band ?? 'evening')
  const [formError, setFormError] = useState<string | null>(null)
  const formId = slot ? `edit-slot-${slot.id}` : 'add-slot'
  const time = (value: string | null) => (value === null ? '' : wallClockTimeInTimeZone(new Date(value), timeZone))

  const save = useMutation(async (form: FormData) => {
    const slotDay = slot?.day ?? formText(form, 'day')
    const starts = formText(form, 'startsAt')
    const ends = formText(form, 'endsAt')
    const kind = formText(form, 'kind')
    const fields = {
      band: chosenBand,
      kind: isKind(kind) ? kind : 'activity',
      label: formText(form, 'label'),
      startsAt: starts === '' ? null : instantInTimeZone(slotDay, starts, timeZone).toISOString(),
      // An end earlier than the start is after midnight: dinner at 10 that runs to 1.
      endsAt: ends === '' ? null : instantInTimeZone(ends < starts ? addCalendarDays(slotDay, 1) : slotDay, ends, timeZone).toISOString(),
      decideBy: formText(form, 'decideBy') || null,
      notes: formText(form, 'notes') || null,
    }
    if (slot) {
      await api.request(updateSlot, { params: { tripId, slotId: slot.id }, body: fields })
    } else {
      const created = await api.request(createSlot, { params: { tripId }, body: { day: slotDay, ...fields } })
      setExpanded(created.slot.id, true)
    }
    closeSheet()
  })

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    const form = new FormData(event.currentTarget)
    const starts = formText(form, 'startsAt')
    const ends = formText(form, 'endsAt')
    if (starts === '' && ends !== '') {
      setFormError('Give it a start time before an end time')
      return
    }
    if (ends !== '' && ends === starts) {
      setFormError('End it after it starts, or leave the end empty')
      return
    }
    save.mutate(form)
  }

  const defaultDay = day ?? days.find(each => each >= today) ?? days[0] ?? today

  return (
    <Sheet
      open
      onOpenChange={open => {
        if (!open) closeSheet()
      }}
      title={slot ? 'Edit slot' : 'Add a slot'}
      description={slot ? formatCalendarDate(slot.day, 'EEEE, MMM d') : 'A time to fill. Add the options for it next.'}
      footer={
        <>
          <SheetClose asChild>
            <Button variant='ghost'>Cancel</Button>
          </SheetClose>
          <Button type='submit' form={formId} disabled={save.pending}>
            {save.pending ? 'Saving…' : slot ? 'Save changes' : 'Add slot'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className='flex flex-col gap-4'>
        <Field label='What for'>
          <Input name='label' required maxLength={200} autoFocus={!slot} defaultValue={slot?.label ?? ''} placeholder='Dinner' />
        </Field>
        <div className='grid grid-cols-2 gap-3'>
          <Field label='Kind'>
            <Select name='kind' defaultValue={slot?.kind ?? 'activity'}>
              {SLOT_KINDS.map(kind => (
                <option key={kind} value={kind}>
                  {SLOT_KIND_LABELS[kind]}
                </option>
              ))}
            </Select>
          </Field>
          {slot ? null : (
            <Field label='Day'>
              <Input name='day' type='date' required defaultValue={defaultDay} />
            </Field>
          )}
          <Field label='Part of the day' className={slot ? undefined : 'col-span-2'}>
            <Select
              name='band'
              value={chosenBand}
              onChange={event => {
                if (isBand(event.target.value)) setChosenBand(event.target.value)
              }}
            >
              {SLOT_BANDS.map(each => (
                <option key={each} value={each}>
                  {SLOT_BAND_LABELS[each]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label='Starts' hint='Optional'>
            <Input
              name='startsAt'
              type='time'
              defaultValue={time(slot?.startsAt ?? null)}
              onChange={event => {
                if (event.target.value !== '') setChosenBand(bandForTime(event.target.value))
              }}
            />
          </Field>
          <Field label='Ends' hint='Optional'>
            <Input name='endsAt' type='time' defaultValue={time(slot?.endsAt ?? null)} />
          </Field>
        </div>
        <Field label='Decide by' hint='Optional. Puts it higher in the decisions queue.'>
          <Input name='decideBy' type='date' defaultValue={slot?.decideBy ?? ''} />
        </Field>
        <Field label='Notes'>
          <Textarea name='notes' rows={3} maxLength={4000} defaultValue={slot?.notes ?? ''} />
        </Field>
        <FormError>{formError ?? save.error}</FormError>
      </form>
    </Sheet>
  )
}
