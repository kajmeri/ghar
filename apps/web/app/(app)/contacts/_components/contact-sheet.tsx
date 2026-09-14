'use client'

import { createContact, updateContact, type Contact } from '@ghar/contracts'
import { normalizeContactTags } from '@ghar/core/contacts'
import { Pencil, Plus } from 'lucide-react'
import { useId, useState, type SyntheticEvent } from 'react'
import { Sheet, SheetClose } from '@/app/(app)/_components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api, type BodyOf } from '@/lib/api/client'
import { formText } from '@/lib/form'
import { withScheme } from '@/lib/urls'

type Fields = NonNullable<BodyOf<typeof updateContact>>

/** Adds someone the household calls, or edits them. */
export function ContactSheet({ contact }: { contact?: Contact }) {
  const formId = useId()
  const [open, setOpen] = useState(false)

  const save = useMutation<[Fields]>(async fields => {
    if (contact) {
      await api.request(updateContact, { params: { contactId: contact.id }, body: fields })
    } else {
      await api.request(createContact, { body: fields })
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
    save.mutate({
      name: formText(data, 'name'),
      role: formText(data, 'role') || null,
      phone: formText(data, 'phone') || null,
      email: formText(data, 'email') || null,
      url: withScheme(formText(data, 'url')) || null,
      notes: formText(data, 'notes') || null,
      tags: normalizeContactTags(formText(data, 'tags').split(',')),
    })
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        contact ? (
          <Button variant='outline'>
            <Pencil aria-hidden />
            Edit details
          </Button>
        ) : (
          <Button>
            <Plus aria-hidden />
            Add a contact
          </Button>
        )
      }
      title={contact ? 'Edit details' : 'Add a contact'}
      footer={
        <>
          <SheetClose asChild>
            <Button type='button' variant='outline'>
              Cancel
            </Button>
          </SheetClose>
          <Button type='submit' form={formId} disabled={save.pending}>
            {save.pending ? 'Saving…' : contact ? 'Save changes' : 'Save contact'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className='flex flex-col gap-4'>
        <Field label='Name'>
          <Input name='name' required maxLength={120} defaultValue={contact?.name} placeholder='Maria Lopez' autoComplete='off' />
        </Field>
        <Field label='What they do'>
          <Input name='role' maxLength={80} defaultValue={contact?.role ?? undefined} placeholder='Plumber' />
        </Field>
        <Field label='Phone'>
          <Input name='phone' type='tel' maxLength={40} defaultValue={contact?.phone ?? undefined} autoComplete='off' />
        </Field>
        <Field label='Email'>
          <Input name='email' type='email' maxLength={254} defaultValue={contact?.email ?? undefined} autoComplete='off' />
        </Field>
        <Field label='Website'>
          <Input
            name='url'
            inputMode='url'
            defaultValue={contact?.url ?? undefined}
            placeholder='acmeplumbing.com'
            autoComplete='off'
            autoCapitalize='none'
          />
        </Field>
        <Field label='Tags' hint='Separate them with commas, like “emergency, kitchen”.'>
          <Input name='tags' defaultValue={contact?.tags.join(', ')} autoComplete='off' autoCapitalize='none' />
        </Field>
        <Field label='Notes' hint='Account numbers, gate codes, who to ask for.'>
          <Textarea name='notes' rows={4} maxLength={4000} defaultValue={contact?.notes ?? undefined} />
        </Field>
        <FormError>{save.error}</FormError>
      </form>
    </Sheet>
  )
}
