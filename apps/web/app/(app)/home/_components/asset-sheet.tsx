'use client'

import { assetKindSchema, createAsset, updateAsset, type Asset } from '@ghar/contracts'
import { ASSET_KINDS } from '@ghar/core/home'
import { Pencil, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useId, useState, type SyntheticEvent } from 'react'
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
import { ASSET_KIND_LABELS } from '@/lib/home/display'

type Fields = NonNullable<BodyOf<typeof updateAsset>>

/**
 * Adds a thing in the house, or edits one. Only the name is needed; the model and serial number
 * are what someone will want when it breaks, so they come right after.
 */
export function AssetSheet({
  asset,
  currency,
  variant = 'default',
}: {
  /** Edits this asset. Leave it out to add one. */
  asset?: Asset
  currency: string
  variant?: 'default' | 'outline'
}) {
  const formId = useId()
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const save = useMutation<[Fields]>(async fields => {
    if (asset) {
      await api.request(updateAsset, { params: { assetId: asset.id }, body: fields })
      setOpen(false)
      return
    }
    const created = await api.request(createAsset, { body: fields })
    setOpen(false)
    // Straight to the new thing, where its documents and jobs get added.
    router.push(`/home/assets/${created.asset.id}`)
  })

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) save.clearError()
  }

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const kind = assetKindSchema.safeParse(formText(data, 'kind'))
    const price = formText(data, 'purchasePriceCents')
    save.mutate({
      name: formText(data, 'name'),
      kind: kind.success ? kind.data : 'other',
      make: formText(data, 'make') || null,
      model: formText(data, 'model') || null,
      serialNumber: formText(data, 'serialNumber') || null,
      location: formText(data, 'location') || null,
      purchasedOn: formText(data, 'purchasedOn') || null,
      purchasePriceCents: price === '' ? null : Number(price),
      warrantyExpiresOn: formText(data, 'warrantyExpiresOn') || null,
      notes: formText(data, 'notes') || null,
    })
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        asset ? (
          <Button variant='outline'>
            <Pencil aria-hidden />
            Edit details
          </Button>
        ) : (
          <Button variant={variant}>
            <Plus aria-hidden />
            Add a thing
          </Button>
        )
      }
      title={asset ? 'Edit details' : 'Add a thing'}
      description={asset ? undefined : 'An appliance, a system like the furnace, or a car.'}
      footer={
        <>
          <SheetClose asChild>
            <Button type='button' variant='outline'>
              Cancel
            </Button>
          </SheetClose>
          <Button type='submit' form={formId} disabled={save.pending}>
            {save.pending ? 'Saving…' : asset ? 'Save changes' : 'Save'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className='flex flex-col gap-4'>
        <Field label='Name'>
          <Input name='name' required maxLength={120} defaultValue={asset?.name} placeholder='Dishwasher' />
        </Field>

        <Field label='Kind'>
          <NativeSelect name='kind' defaultValue={asset?.kind ?? 'appliance'}>
            {ASSET_KINDS.map(kind => (
              <option key={kind} value={kind}>
                {ASSET_KIND_LABELS[kind]}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <div className='grid grid-cols-2 gap-3'>
          <Field label='Make'>
            <Input name='make' maxLength={120} defaultValue={asset?.make ?? undefined} placeholder='Bosch' />
          </Field>
          <Field label='Model'>
            <Input name='model' maxLength={120} defaultValue={asset?.model ?? undefined} autoComplete='off' />
          </Field>
        </div>

        <Field label='Serial number' hint='Usually on a sticker inside the door or on the back.'>
          <Input name='serialNumber' maxLength={120} defaultValue={asset?.serialNumber ?? undefined} autoComplete='off' />
        </Field>

        <Field label='Where it is'>
          <Input name='location' maxLength={120} defaultValue={asset?.location ?? undefined} placeholder='Kitchen' />
        </Field>

        <div className='grid grid-cols-2 gap-3'>
          <DateField
            id={`${formId}-purchased`}
            name='purchasedOn'
            label='Bought'
            defaultValue={asset?.purchasedOn ?? undefined}
          />
          <DateField
            id={`${formId}-warranty`}
            name='warrantyExpiresOn'
            label='Warranty ends'
            defaultValue={asset?.warrantyExpiresOn ?? undefined}
          />
        </div>

        <MoneyInput
          id={`${formId}-price`}
          name='purchasePriceCents'
          label='Price'
          currency={currency}
          defaultValue={asset?.purchasePriceCents ?? undefined}
        />

        <Field label='Notes'>
          <Textarea name='notes' rows={3} maxLength={4000} defaultValue={asset?.notes ?? undefined} />
        </Field>

        <FormError>{save.error}</FormError>
      </form>
    </Sheet>
  )
}
