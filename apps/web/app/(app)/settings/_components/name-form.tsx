'use client'

import { updateMyProfile } from '@ghar/contracts'
import { useState, type SyntheticEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { formText } from '@/lib/form'

/** The caller's own name, the one the rest of the household sees on trips, lists and emails. */
export function NameForm({ fullName }: { fullName: string | null }) {
  const [saved, setSaved] = useState(false)
  const save = useMutation(async (name: string) => {
    await api.request(updateMyProfile, { body: { fullName: name } })
    setSaved(true)
  })

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaved(false)
    save.mutate(formText(new FormData(event.currentTarget), 'fullName'))
  }

  return (
    <form onSubmit={onSubmit} className='flex flex-col gap-3 rounded-card border border-line bg-surface p-4'>
      <Field
        label='Your name'
        hint={fullName === null ? 'Add it so the household sees who you are, not a code.' : 'How everyone in the household sees you.'}
      >
        <Input
          name='fullName'
          required
          maxLength={100}
          autoComplete='name'
          defaultValue={fullName ?? ''}
          onChange={() => {
            setSaved(false)
          }}
        />
      </Field>
      <FormError>{save.error}</FormError>
      <div className='flex items-center gap-3'>
        <Button type='submit' variant='outline' disabled={save.pending}>
          {save.pending ? 'Saving…' : 'Save name'}
        </Button>
        <p role='status' className='text-sm text-ink-muted'>
          {saved && !save.pending ? 'Saved' : ''}
        </p>
      </div>
    </form>
  )
}
