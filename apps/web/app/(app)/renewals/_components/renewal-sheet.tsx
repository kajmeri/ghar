'use client'

import { createRenewal, renewalKindSchema, updateRenewal, type Renewal } from '@ghar/contracts'
import { DEFAULT_REMINDER_LEAD_DAYS } from '@ghar/core/expiries'
import { renewalCadenceLabel } from '@ghar/core/renewals'
import { Pencil, Plus } from 'lucide-react'
import { useId, useState, type SyntheticEvent } from 'react'
import { CheckboxField } from '@/app/(app)/_components/ui/checkbox-field'
import { DateField } from '@/app/(app)/_components/ui/date-field'
import { MoneyInput } from '@/app/(app)/_components/ui/money-input'
import { PersonField } from '@/app/(app)/_components/ui/person-field'
import { ReminderLeadField, remindFromDaysOf } from '@/app/(app)/_components/ui/reminder-lead-field'
import { Sheet, SheetClose } from '@/app/(app)/_components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { NativeSelect } from '@/components/ui/native-select'
import { useMutation } from '@/hooks/use-mutation'
import { api, type BodyOf } from '@/lib/api/client'
import { formText } from '@/lib/form'
import { RENEWAL_CADENCE_OPTIONS, RENEWAL_KIND_LABELS } from '@/lib/renewals/display'
import type { RenewalFormOptions } from '@/lib/renewals/service'
import { withScheme } from '@/lib/urls'

type Fields = NonNullable<BodyOf<typeof updateRenewal>>

const KINDS = renewalKindSchema.options

/** Adds something the household renews, or edits one. */
export function RenewalSheet({ renewal, options, currency }: { renewal?: Renewal; options: RenewalFormOptions; currency: string }) {
  const formId = useId()
  const [open, setOpen] = useState(false)
  const [autoRenews, setAutoRenews] = useState(renewal?.autoRenews ?? false)

  const save = useMutation<[Fields]>(async fields => {
    if (renewal) {
      await api.request(updateRenewal, { params: { renewalId: renewal.id }, body: fields })
    } else {
      await api.request(createRenewal, { body: fields })
    }
    setOpen(false)
  })

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    setAutoRenews(renewal?.autoRenews ?? false)
    if (!next) save.clearError()
  }

  // A cadence stored outside the menu keeps its place in it.
  const cadences =
    renewal?.cadenceMonths && !(RENEWAL_CADENCE_OPTIONS as readonly number[]).includes(renewal.cadenceMonths)
      ? [...RENEWAL_CADENCE_OPTIONS, renewal.cadenceMonths].toSorted((a, b) => a - b)
      : RENEWAL_CADENCE_OPTIONS
  // A linked document the editor can't see stays linked; it just can't be picked.
  const hiddenDocument = renewal?.documentId && !options.documents.some(document => document.id === renewal.documentId)

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const kind = renewalKindSchema.safeParse(formText(data, 'kind'))
    const cost = formText(data, 'costCents')
    const cadence = formText(data, 'cadenceMonths')
    save.mutate({
      title: formText(data, 'title'),
      kind: kind.success ? kind.data : 'other',
      expiresOn: formText(data, 'expiresOn'),
      remindFromDays: remindFromDaysOf(data),
      cadenceMonths: cadence === '' ? null : Number(cadence),
      autoRenews: data.get('autoRenews') === 'on',
      costCents: cost === '' ? null : Number(cost),
      provider: formText(data, 'provider') || null,
      referenceNumber: formText(data, 'referenceNumber') || null,
      url: withScheme(formText(data, 'url')) || null,
      contactId: formText(data, 'contactId') || null,
      assetId: formText(data, 'assetId') || null,
      personId: formText(data, 'personId') || null,
      documentId: hiddenDocument ? (renewal.documentId ?? null) : formText(data, 'documentId') || null,
      notes: formText(data, 'notes') || null,
    })
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        renewal ? (
          <Button variant='outline'>
            <Pencil aria-hidden />
            Edit renewal
          </Button>
        ) : (
          <Button>
            <Plus aria-hidden />
            Add a renewal
          </Button>
        )
      }
      title={renewal ? 'Edit renewal' : 'Add a renewal'}
      description={renewal ? undefined : 'Anything with a date it runs out: a registration, a license, a membership.'}
      footer={
        <>
          <SheetClose asChild>
            <Button type='button' variant='outline'>
              Cancel
            </Button>
          </SheetClose>
          <Button type='submit' form={formId} disabled={save.pending}>
            {save.pending ? 'Saving…' : renewal ? 'Save changes' : 'Save renewal'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className='flex flex-col gap-4'>
        <Field label='Name'>
          <Input name='title' required maxLength={120} defaultValue={renewal?.title} placeholder='Car registration' />
        </Field>

        <div className='grid grid-cols-2 gap-3'>
          <Field label='Kind'>
            <NativeSelect name='kind' defaultValue={renewal?.kind ?? 'other'}>
              {KINDS.map(kind => (
                <option key={kind} value={kind}>
                  {RENEWAL_KIND_LABELS[kind]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <DateField
            id={`${formId}-expires`}
            name='expiresOn'
            label={autoRenews ? 'Renews on' : 'Runs out on'}
            required
            defaultValue={renewal?.expiresOn}
          />
        </div>

        <CheckboxField
          name='autoRenews'
          label='Renews on its own'
          hint='A subscription or a policy that rolls over. Ghar moves the date on each term and reminds you in case you want to cancel.'
          checked={autoRenews}
          onChange={event => setAutoRenews(event.target.checked)}
        />

        <Field label='How often' hint={autoRenews ? undefined : 'Leave it empty if there’s no set schedule.'}>
          <NativeSelect name='cadenceMonths' required={autoRenews} defaultValue={renewal?.cadenceMonths ?? ''}>
            <option value=''>{autoRenews ? 'Pick how often' : 'No set schedule'}</option>
            {cadences.map(months => (
              <option key={months} value={months}>
                {renewalCadenceLabel(months)}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <ReminderLeadField value={renewal?.remindFromDays} defaultLeadDays={DEFAULT_REMINDER_LEAD_DAYS} />

        <PersonField people={options.people} defaultValue={renewal?.personId ?? null} hint='A driving licence or a membership belongs to someone.' />

        <MoneyInput
          id={`${formId}-cost`}
          name='costCents'
          label='What it costs to renew'
          currency={currency}
          defaultValue={renewal?.costCents ?? undefined}
        />

        <Field label='Who it’s with'>
          <Input name='provider' maxLength={200} defaultValue={renewal?.provider ?? undefined} placeholder='Texas DMV' />
        </Field>

        <Field label='Reference number' hint='A plate, a member number. Leave out anything you wouldn’t want read over your shoulder.'>
          <Input name='referenceNumber' maxLength={200} defaultValue={renewal?.referenceNumber ?? undefined} autoComplete='off' />
        </Field>

        <Field label='Where to renew it'>
          <Input
            name='url'
            inputMode='url'
            defaultValue={renewal?.url ?? undefined}
            placeholder='txdmv.gov'
            autoComplete='off'
            autoCapitalize='none'
          />
        </Field>

        {options.assets.length > 0 ? (
          <Field label='For'>
            <NativeSelect name='assetId' defaultValue={renewal?.assetId ?? ''}>
              <option value=''>Nothing in the house</option>
              {options.assets.map(asset => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}

        {options.contacts.length > 0 ? (
          <Field label='Who to call'>
            <NativeSelect name='contactId' defaultValue={renewal?.contactId ?? ''}>
              <option value=''>Nobody</option>
              {options.contacts.map(contact => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}

        {hiddenDocument ? null : options.documents.length > 0 ? (
          <Field label='Current paper' hint='The document for this term, if Ghar has it.'>
            <NativeSelect name='documentId' defaultValue={renewal?.documentId ?? ''}>
              <option value=''>None</option>
              {options.documents.map(document => (
                <option key={document.id} value={document.id}>
                  {document.title}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}

        <Field label='Notes' hint='What renewing takes, what to bring.'>
          <Textarea name='notes' rows={3} maxLength={4000} defaultValue={renewal?.notes ?? undefined} />
        </Field>

        <FormError>{save.error}</FormError>
      </form>
    </Sheet>
  )
}
