'use client'

import { createOption, createOptionFromIdea, createOptionFromLink, updateOption, type ItinerarySlot } from '@ghar/contracts'
import { ChevronDown } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import { Sheet, SheetClose } from '@/app/(app)/_components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { formText } from '@/lib/form'
import { isLikelyUrl, slotWhenLabel } from '@/lib/travel/itinerary-display'
import { useItinerary } from './itinerary-context'
import { CostFields, OptionFields, filledDetails, readOptionDetails, type OptionDetails } from './option-form'

interface NewOption {
  text: string
  choose: boolean
  details: OptionDetails
}

/**
 * Getting an option in, in the order people actually do it: paste a link, or type a name and
 * maybe a price. Everything else is folded away. Ideas already on the board are one tap.
 */
export function AddOptionSheet({ slot }: { slot: ItinerarySlot }) {
  const { tripId, timeZone, ideas, closeSheet, setExpanded } = useItinerary()
  const [text, setText] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const formId = `add-option-${slot.id}`

  const add = useMutation(async ({ text: entered, choose, details }: NewOption) => {
    const extra = filledDetails(details)
    if (isLikelyUrl(entered)) {
      // The page names itself; what was typed in the other fields is laid on top of that.
      const before = new Set(slot.options.map(option => option.id))
      const { slot: after } = await api.request(createOptionFromLink, {
        params: { tripId, slotId: slot.id },
        body: { url: entered.trim(), choose },
      })
      const created = after.options.find(option => !before.has(option.id))
      if (created && Object.keys(extra).length > 0) {
        await api.request(updateOption, { params: { tripId, optionId: created.id }, body: extra })
      }
    } else {
      await api.request(createOption, {
        params: { tripId, slotId: slot.id },
        body: { ...extra, title: entered, source: 'manual', choose },
      })
    }
    setExpanded(slot.id, !choose)
    closeSheet()
  })

  const promote = useMutation(async (ideaId: string) => {
    await api.request(createOptionFromIdea, { params: { tripId, slotId: slot.id }, body: { ideaId } })
    setExpanded(slot.id, true)
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
    add.mutate({ text: formText(form, 'title'), choose: form.get('choose') === 'on', details: details.value })
  }

  const taken = new Set(slot.options.map(option => option.title.toLowerCase()))
  const available = ideas.filter(idea => !taken.has(idea.title.toLowerCase()))
  const pending = add.pending || promote.pending

  return (
    <Sheet
      open
      onOpenChange={open => {
        if (!open) closeSheet()
      }}
      title={`Add an option for ${slot.label.toLowerCase()}`}
      description={slotWhenLabel(slot, timeZone)}
      footer={
        <>
          <SheetClose asChild>
            <Button variant='ghost'>Cancel</Button>
          </SheetClose>
          <Button type='submit' form={formId} disabled={pending}>
            {add.pending ? 'Adding…' : 'Add option'}
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-6'>
        <form id={formId} onSubmit={onSubmit} className='flex flex-col gap-4'>
          <Field
            label='Paste a link or type a name'
            hint={isLikelyUrl(text) ? 'The name and picture come from the page.' : undefined}
          >
            <Input
              name='title'
              required
              maxLength={2000}
              autoFocus
              value={text}
              onChange={event => {
                setText(event.target.value)
              }}
              placeholder='Cervejaria Ramiro, or https://…'
            />
          </Field>
          <CostFields idPrefix={formId} kind={slot.kind} />
          <details className='group'>
            <summary className='flex min-h-tap cursor-pointer list-none items-center gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden'>
              More details
              <ChevronDown aria-hidden className='size-4 text-ink-muted group-open:rotate-180' />
            </summary>
            <div className='pt-2'>
              <OptionFields />
            </div>
          </details>
          <label className='flex min-h-tap cursor-pointer items-center gap-3 self-start text-base'>
            <input type='checkbox' name='choose' className='size-5 shrink-0 accent-ink' />
            Choose it now
          </label>
          <FormError>{formError ?? add.error}</FormError>
        </form>

        {available.length > 0 ? (
          <section className='flex flex-col gap-2 border-t border-line pt-4'>
            <h3 className='text-sm font-medium'>From the ideas board</h3>
            <ul className='flex flex-col divide-y divide-line'>
              {available.map(idea => (
                <li key={idea.id} className='flex min-h-tap items-center gap-3 py-1'>
                  <span className='flex min-w-0 flex-1 flex-col'>
                    <span className='truncate'>{idea.title}</span>
                    {idea.destination ? <span className='truncate text-sm text-ink-muted'>{idea.destination}</span> : null}
                  </span>
                  <Button
                    variant='outline'
                    disabled={pending}
                    onClick={() => {
                      promote.mutate(idea.id)
                    }}
                  >
                    Add
                  </Button>
                </li>
              ))}
            </ul>
            <FormError>{promote.error}</FormError>
          </section>
        ) : null}
      </div>
    </Sheet>
  )
}
