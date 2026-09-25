'use client'

import { HEALTH_CARD_NOTE_MAX, bloodTypeSchema, saveHealthCard, type BloodTypeValue, type HealthCard } from '@ghar/contracts'
import { bloodTypeLabel } from '@ghar/core/health'
import { useId, useState, type ReactElement, type SyntheticEvent } from 'react'
import { Sheet, SheetClose } from '@/app/(app)/_components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { NativeSelect } from '@/components/ui/native-select'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { formText } from '@/lib/form'
import type { HealthFormOptions } from '@/lib/health/service'

/** One per line, as typed. The server trims, drops blanks and repeats. */
const lines = (text: string) => text.split('\n').filter(line => line.trim() !== '')

/**
 * Edits one person's whole health card. Medicines aren't here: the card shows what they take now
 * from their medicines, so there's one place to keep that.
 */
export function HealthCardSheet({ card, options, trigger }: { card: HealthCard; options: HealthFormOptions; trigger: ReactElement }) {
  const formId = useId()
  const [open, setOpen] = useState(false)

  const save = useMutation(async (data: FormData) => {
    const bloodType = bloodTypeSchema.safeParse(formText(data, 'bloodType'))
    await api.request(saveHealthCard, {
      params: { personId: card.personId },
      body: {
        bloodType: bloodType.success ? bloodType.data : null,
        allergies: lines(formText(data, 'allergies')),
        conditions: lines(formText(data, 'conditions')),
        doctorContactId: formText(data, 'doctorContactId') || null,
        insuranceDocumentId: formText(data, 'insuranceDocumentId') || null,
        emergencyNote: formText(data, 'emergencyNote') || null,
      },
    })
    setOpen(false)
  })

  const onSubmit = (submitted: SyntheticEvent<HTMLFormElement>) => {
    submitted.preventDefault()
    save.mutate(new FormData(submitted.currentTarget))
  }

  const hiddenDoctor = card.doctorContactId !== null && !options.contacts.some(contact => contact.id === card.doctorContactId)
  // Linked by someone who can open it, for someone who can't. It stays unless they take it off.
  const hiddenInsurance = card.insuranceDocumentId !== null && !options.documents.some(document => document.id === card.insuranceDocumentId)

  return (
    <Sheet
      open={open}
      onOpenChange={next => {
        if (!next) save.clearError()
        setOpen(next)
      }}
      trigger={trigger}
      title='Health card'
      description={`What someone helping ${card.personName === 'You' ? 'you' : card.personName} would need to know. Fill in what you know.`}
      footer={
        <>
          <SheetClose asChild>
            <Button type='button' variant='outline'>
              Cancel
            </Button>
          </SheetClose>
          <Button type='submit' form={formId} disabled={save.pending}>
            {save.pending ? 'Saving…' : 'Save card'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className='flex flex-col gap-4'>
        <Field label='Allergies' hint='One per line, like “Penicillin” or “Peanuts”.'>
          <Textarea name='allergies' rows={3} defaultValue={card.allergies.join('\n')} />
        </Field>

        <Field label='Conditions' hint='One per line, like “Asthma”. Keep it short.'>
          <Textarea name='conditions' rows={3} defaultValue={card.conditions.join('\n')} />
        </Field>

        <Field label='Blood type'>
          <NativeSelect name='bloodType' defaultValue={card.bloodType ?? ''}>
            <option value=''>Not known</option>
            {bloodTypeSchema.options.map((type: BloodTypeValue) => (
              <option key={type} value={type}>
                {bloodTypeLabel(type)}
              </option>
            ))}
          </NativeSelect>
        </Field>

        {hiddenDoctor ? (
          <input type='hidden' name='doctorContactId' value={card.doctorContactId ?? ''} />
        ) : options.contacts.length > 0 ? (
          <Field label='Doctor' hint='From your contacts. Their phone number shows on the card.'>
            <NativeSelect name='doctorContactId' defaultValue={card.doctorContactId ?? ''}>
              <option value=''>Nobody yet</option>
              {options.contacts.map(contact => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}

        {hiddenInsurance ? (
          <Field label='Insurance card' hint='Someone who can open it linked it for you.'>
            <NativeSelect name='insuranceDocumentId' defaultValue={card.insuranceDocumentId ?? ''}>
              <option value={card.insuranceDocumentId ?? ''}>Keep the one on file</option>
              <option value=''>Take it off the card</option>
            </NativeSelect>
          </Field>
        ) : options.documents.length > 0 ? (
          <Field label='Insurance card' hint='A photo or scan from your documents.'>
            <NativeSelect name='insuranceDocumentId' defaultValue={card.insuranceDocumentId ?? ''}>
              <option value=''>None</option>
              {options.documents.map(document => (
                <option key={document.id} value={document.id}>
                  {document.title}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}

        <Field label='Note for whoever’s helping' hint='Like “Carries an EpiPen in her bag”.'>
          <Input name='emergencyNote' maxLength={HEALTH_CARD_NOTE_MAX} defaultValue={card.emergencyNote ?? undefined} />
        </Field>

        <FormError>{save.error}</FormError>
      </form>
    </Sheet>
  )
}
