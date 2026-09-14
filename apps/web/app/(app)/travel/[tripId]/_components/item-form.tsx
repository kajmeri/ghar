'use client'

import { createItineraryItem, updateItineraryItem, type ItineraryItem } from '@ghar/contracts'
import { instantInTimeZone, wallClockTimeInTimeZone } from '@ghar/core/dates'
import { ITINERARY_KINDS, type ItineraryKind } from '@ghar/core/itinerary'
import { parseMoneyInput } from '@ghar/core/money'
import { useState, type SyntheticEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { formText } from '@/lib/form'

const KIND_LABEL: Record<ItineraryKind, string> = {
  flight: 'Flight',
  lodging: 'Stay',
  activity: 'Activity',
  meal: 'Meal',
  transport: 'Transport',
  note: 'Note',
}

/**
 * Adding a row, or editing one. Times are typed as wall-clock times on the day, which is
 * how a person thinks about them, and turned into instants in the household's zone here.
 * That conversion is the reason this is one form rather than two.
 */
export function ItemForm({
  tripId,
  timeZone,
  day,
  item,
  onDone,
}: {
  tripId: string
  timeZone: string
  day: string
  item: ItineraryItem | null
  onDone: () => void
}) {
  const [costError, setCostError] = useState<string | null>(null)

  const { mutate, pending, error } = useMutation(async (form: FormData) => {
    const itemDay = formText(form, 'day')
    const startsTime = formText(form, 'startsAt')
    const endsTime = formText(form, 'endsAt')
    const cost = formText(form, 'cost')

    const body = {
      day: itemDay,
      kind: formText(form, 'kind') as ItineraryKind,
      title: formText(form, 'title'),
      location: formText(form, 'location') || null,
      address: formText(form, 'address') || null,
      confirmationCode: formText(form, 'confirmationCode') || null,
      url: formText(form, 'url') || null,
      notes: formText(form, 'notes') || null,
      costCents: cost === '' ? null : parseMoneyInput(cost),
      startsAt: startsTime === '' ? null : instantInTimeZone(itemDay, startsTime, timeZone).toISOString(),
      endsAt: endsTime === '' ? null : instantInTimeZone(itemDay, endsTime, timeZone).toISOString(),
    }

    if (item) {
      await api.request(updateItineraryItem, {
        params: { tripId, itemId: item.id },
        body,
      })
    } else {
      await api.request(createItineraryItem, { params: { tripId }, body })
    }
    onDone()
  })

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCostError(null)
    const form = new FormData(event.currentTarget)

    const cost = formText(form, 'cost')
    if (cost !== '') {
      try {
        parseMoneyInput(cost)
      } catch {
        setCostError('Write the cost as an amount, like 84.20')
        return
      }
    }
    mutate(form)
  }

  const time = (value: string | null) => (value === null ? '' : wallClockTimeInTimeZone(new Date(value), timeZone))

  return (
    <Card className='p-4 md:p-5'>
      <form onSubmit={onSubmit} className='flex flex-col gap-4'>
        <p className='text-base font-semibold'>{item ? 'Edit this' : 'Add to the itinerary'}</p>

        <div className='grid gap-4 md:grid-cols-2'>
          <Field label='What is it'>
            <Input name='title' required maxLength={200} autoFocus defaultValue={item?.title ?? ''} placeholder='Tram 28 to Graça' />
          </Field>
          <Field label='Kind'>
            <Select name='kind' defaultValue={item?.kind ?? 'activity'}>
              {ITINERARY_KINDS.map(kind => (
                <option key={kind} value={kind}>
                  {KIND_LABEL[kind]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label='Day'>
            <Input name='day' type='date' required defaultValue={item?.day ?? day} />
          </Field>
          <div className='grid grid-cols-2 gap-4'>
            <Field label='Starts'>
              <Input name='startsAt' type='time' defaultValue={time(item?.startsAt ?? null)} />
            </Field>
            <Field label='Ends'>
              <Input name='endsAt' type='time' defaultValue={time(item?.endsAt ?? null)} />
            </Field>
          </div>
          <Field label='Where'>
            <Input name='location' maxLength={200} defaultValue={item?.location ?? ''} />
          </Field>
          <Field label='Address'>
            <Input name='address' maxLength={200} defaultValue={item?.address ?? ''} />
          </Field>
          <Field label='Confirmation code'>
            <Input name='confirmationCode' maxLength={200} defaultValue={item?.confirmationCode ?? ''} />
          </Field>
          <Field label='Cost'>
            <Input
              name='cost'
              inputMode='decimal'
              defaultValue={item?.costCents === null || item === null ? '' : String(item.costCents / 100)}
            />
          </Field>
          <Field label='Link' className='md:col-span-2'>
            <Input name='url' type='url' defaultValue={item?.url ?? ''} placeholder='https://' />
          </Field>
          <Field label='Notes' className='md:col-span-2'>
            <Textarea name='notes' rows={3} maxLength={4000} defaultValue={item?.notes ?? ''} />
          </Field>
        </div>

        <FormError>{costError ?? error}</FormError>

        <div className='flex gap-2'>
          <Button type='submit' disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
          <Button type='button' variant='ghost' onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}
