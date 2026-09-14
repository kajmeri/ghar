'use client'

import { updateOption, type ItineraryOption, type ItinerarySlot, type UpdateOptionBody } from '@ghar/contracts'
import { COST_BASES, type CostBasis, type SlotKind } from '@ghar/core/itinerary'
import type { SyntheticEvent } from 'react'
import { useState } from 'react'
import { Sheet, SheetClose } from '@/app/(app)/_components/ui/sheet'
import { MoneyInput } from '@/app/(app)/_components/ui/money-input'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { formText } from '@/lib/form'
import { defaultCostBasis } from '@/lib/travel/itinerary-display'
import { useItinerary } from './itinerary-context'

/** Everything about an option except its title, as a full replacement: blank fields clear. */
export type OptionDetails = Required<Omit<UpdateOptionBody, 'title'>>

const BASIS_LABELS: Record<CostBasis, string> = { per_person: 'Each', total: 'In total' }
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** Price and whether it is per head. Shown up front when adding, because it is what gets compared. */
export function CostFields({ idPrefix, option, kind }: { idPrefix: string; option?: ItineraryOption; kind: SlotKind }) {
  return (
    <div className='grid grid-cols-[minmax(0,1fr)_8rem] items-start gap-3'>
      <MoneyInput
        id={`${idPrefix}-cost`}
        name='costCents'
        label='Cost'
        hint='Optional'
        defaultValue={option?.costCents ?? undefined}
      />
      <Field label='Priced'>
        <Select name='costBasis' defaultValue={option?.costBasis ?? defaultCostBasis(kind)}>
          {COST_BASES.map(basis => (
            <option key={basis} value={basis}>
              {BASIS_LABELS[basis]}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  )
}

/** The rest of an option: where it is, when it is open, whether it needs booking. */
export function OptionFields({ option }: { option?: ItineraryOption }) {
  return (
    <div className='grid gap-4 md:grid-cols-2'>
      <Field label='Short description' className='md:col-span-2'>
        <Input name='subtitle' maxLength={200} defaultValue={option?.subtitle ?? ''} placeholder='Tasting menu, counter seats' />
      </Field>
      <Field label='Address' className='md:col-span-2'>
        <Input name='address' maxLength={200} defaultValue={option?.address ?? ''} />
      </Field>
      <div className='grid grid-cols-2 gap-3 md:col-span-2'>
        <Field label='Latitude'>
          <Input name='lat' inputMode='decimal' defaultValue={option?.lat ?? ''} placeholder='38.7139' />
        </Field>
        <Field label='Longitude'>
          <Input name='lng' inputMode='decimal' defaultValue={option?.lng ?? ''} placeholder='-9.1394' />
        </Field>
      </div>
      <Field label='Takes (minutes)'>
        <Input name='durationMinutes' type='number' min={1} step={1} defaultValue={option?.durationMinutes ?? ''} />
      </Field>
      <div className='grid grid-cols-2 gap-3'>
        <Field label='Opens'>
          <Input name='opensAt' type='time' defaultValue={option?.opensAt ?? ''} />
        </Field>
        <Field label='Closes'>
          <Input name='closesAt' type='time' defaultValue={option?.closesAt ?? ''} />
        </Field>
      </div>
      <fieldset className='flex flex-col gap-1.5 md:col-span-2'>
        <legend className='text-sm font-medium'>Closed on</legend>
        <div className='flex flex-wrap gap-x-4'>
          {WEEKDAYS.map((name, day) => (
            <label key={name} className='flex min-h-tap cursor-pointer items-center gap-2 text-base'>
              <input
                type='checkbox'
                name='closedDays'
                value={day}
                defaultChecked={option?.closedDays.includes(day) ?? false}
                className='size-5 shrink-0 accent-ink'
              />
              {name}
            </label>
          ))}
        </div>
      </fieldset>
      <label className='flex min-h-tap cursor-pointer items-center gap-3 self-start text-base md:col-span-2'>
        <input type='checkbox' name='bookingRequired' defaultChecked={option?.bookingRequired ?? false} className='size-5 shrink-0 accent-ink' />
        Needs a reservation
      </label>
      <Field label='Reserve by'>
        <Input name='bookingDeadline' type='date' defaultValue={option?.bookingDeadline ?? ''} />
      </Field>
      <Field label='Confirmation code'>
        <Input name='confirmationCode' maxLength={40} defaultValue={option?.confirmationCode ?? ''} />
      </Field>
      <Field label='Booking link' className='md:col-span-2'>
        <Input name='bookingUrl' type='url' defaultValue={option?.bookingUrl ?? ''} placeholder='https://' />
      </Field>
      <Field label='Link' className='md:col-span-2'>
        <Input name='url' type='url' defaultValue={option?.url ?? ''} placeholder='https://' />
      </Field>
      <Field label='Picture link' className='md:col-span-2'>
        <Input name='imageUrl' type='url' defaultValue={option?.imageUrl ?? ''} placeholder='https://' />
      </Field>
      <Field label='Tags' hint='Separate with commas' className='md:col-span-2'>
        <Input name='tags' defaultValue={option?.tags.join(', ') ?? ''} placeholder='vegetarian, view' />
      </Field>
      <Field label='Notes' className='md:col-span-2'>
        <Textarea name='notes' rows={3} maxLength={4000} defaultValue={option?.notes ?? ''} />
      </Field>
    </div>
  )
}

type Read<T> = { ok: true; value: T } | { ok: false; error: string }

function readNumber(form: FormData, name: string, label: string): Read<number | null> {
  const raw = formText(form, name)
  if (raw === '') return { ok: true, value: null }
  const value = Number(raw)
  return Number.isFinite(value) ? { ok: true, value } : { ok: false, error: `${label} has to be a number` }
}

/** Reads CostFields and OptionFields back out of a form. Half a pair is caught here, before a round trip. */
export function readOptionDetails(form: FormData): Read<OptionDetails> {
  const lat = readNumber(form, 'lat', 'Latitude')
  if (!lat.ok) return lat
  const lng = readNumber(form, 'lng', 'Longitude')
  if (!lng.ok) return lng
  if ((lat.value === null) !== (lng.value === null)) return { ok: false, error: 'Give both a latitude and a longitude' }

  const duration = readNumber(form, 'durationMinutes', 'How long it takes')
  if (!duration.ok) return duration
  const cost = readNumber(form, 'costCents', 'Cost')
  if (!cost.ok) return cost

  const opensAt = formText(form, 'opensAt') || null
  const closesAt = formText(form, 'closesAt') || null
  if ((opensAt === null) !== (closesAt === null)) return { ok: false, error: 'Give both an opening and a closing time' }

  const basis = formText(form, 'costBasis')
  const text = (name: string) => formText(form, name) || null

  return {
    ok: true,
    value: {
      subtitle: text('subtitle'),
      url: text('url'),
      imageUrl: text('imageUrl'),
      address: text('address'),
      lat: lat.value,
      lng: lng.value,
      costCents: cost.value,
      costBasis: basis === 'per_person' ? 'per_person' : 'total',
      durationMinutes: duration.value === null ? null : Math.round(duration.value),
      opensAt,
      closesAt,
      closedDays: form
        .getAll('closedDays')
        .map(Number)
        .filter(day => Number.isInteger(day) && day >= 0 && day <= 6),
      bookingRequired: form.get('bookingRequired') === 'on',
      bookingUrl: text('bookingUrl'),
      bookingDeadline: text('bookingDeadline'),
      confirmationCode: text('confirmationCode'),
      tags: formText(form, 'tags')
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean),
      notes: text('notes'),
    },
  }
}

/** Only what was filled in, for adding to an option a link has already described. */
export function filledDetails(details: OptionDetails): UpdateOptionBody {
  const body: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(details)) {
    if (key === 'costBasis') continue
    if (value === null || value === false || (Array.isArray(value) && value.length === 0)) continue
    body[key] = value
  }
  if (details.costCents !== null) body.costBasis = details.costBasis
  return body as UpdateOptionBody
}

export function EditOptionSheet({ slot, option }: { slot: ItinerarySlot; option: ItineraryOption }) {
  const { tripId, closeSheet } = useItinerary()
  const [formError, setFormError] = useState<string | null>(null)
  const formId = `edit-option-${option.id}`

  const save = useMutation(async (body: UpdateOptionBody) => {
    await api.request(updateOption, { params: { tripId, optionId: option.id }, body })
    closeSheet()
  })

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    const form = new FormData(event.currentTarget)
    const details = readOptionDetails(form)
    if (!details.ok) {
      setFormError(details.error)
      return
    }
    save.mutate({ title: formText(form, 'title'), ...details.value })
  }

  return (
    <Sheet
      open
      onOpenChange={open => {
        if (!open) closeSheet()
      }}
      title='Edit option'
      description={slot.label}
      footer={
        <>
          <SheetClose asChild>
            <Button variant='ghost'>Cancel</Button>
          </SheetClose>
          <Button type='submit' form={formId} disabled={save.pending}>
            {save.pending ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className='flex flex-col gap-4'>
        <Field label='Name'>
          <Input name='title' required maxLength={200} defaultValue={option.title} />
        </Field>
        <CostFields idPrefix={formId} option={option} kind={slot.kind} />
        <OptionFields option={option} />
        <FormError>{formError ?? save.error}</FormError>
      </form>
    </Sheet>
  )
}
