'use client'

import { createPerson, deletePerson, updatePerson } from '@ghar/contracts'
import { PERSON_NAME_MAX_LENGTH } from '@ghar/core/people'
import { UserPlus } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import { DeleteButton } from '@/app/(app)/_components/ui/delete-button'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { formText } from '@/lib/form'

/** Adds someone without an account. The field clears once they're in. */
export function AddPersonForm() {
  const [key, setKey] = useState(0)
  const add = useMutation(async (name: string) => {
    await api.request(createPerson, { body: { name } })
    setKey(value => value + 1)
  })

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    add.mutate(formText(new FormData(event.currentTarget), 'name'))
  }

  return (
    <form key={key} onSubmit={onSubmit} className='flex flex-col gap-3 rounded-card border border-line bg-surface p-4 md:flex-row md:items-end'>
      <Field label='Name' className='md:flex-1'>
        <Input name='name' required maxLength={PERSON_NAME_MAX_LENGTH} autoComplete='off' />
      </Field>
      <Button type='submit' disabled={add.pending}>
        <UserPlus aria-hidden />
        {add.pending ? 'Adding…' : 'Add person'}
      </Button>
      <FormError>{add.error}</FormError>
    </form>
  )
}

/** Rename or remove someone without an account. */
export function PersonControls({ personId, name }: { personId: string; name: string }) {
  const [renaming, setRenaming] = useState(false)
  const rename = useMutation(async (next: string) => {
    await api.request(updatePerson, { params: { personId }, body: { name: next } })
    setRenaming(false)
  })

  if (renaming) {
    const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
      event.preventDefault()
      rename.mutate(formText(new FormData(event.currentTarget), 'name'))
    }
    return (
      <form onSubmit={onSubmit} className='mt-4 flex flex-col gap-3 border-t border-line pt-4 md:flex-row md:items-end'>
        <Field label='Name' className='md:flex-1'>
          <Input name='name' required maxLength={PERSON_NAME_MAX_LENGTH} defaultValue={name} autoComplete='off' autoFocus />
        </Field>
        <div className='flex gap-2'>
          <Button type='submit' disabled={rename.pending}>
            {rename.pending ? 'Saving…' : 'Save changes'}
          </Button>
          <Button
            type='button'
            variant='ghost'
            onClick={() => {
              rename.clearError()
              setRenaming(false)
            }}
          >
            Cancel
          </Button>
        </div>
        <FormError>{rename.error}</FormError>
      </form>
    )
  }

  return (
    <div className='mt-4 flex flex-wrap gap-2 border-t border-line pt-4'>
      <Button
        variant='outline'
        onClick={() => {
          setRenaming(true)
        }}
      >
        Rename<span className='sr-only'> {name}</span>
      </Button>
      <DeleteButton
        label='Remove'
        accessibleLabel={`Remove ${name}`}
        title={`Remove ${name}?`}
        description='Their documents and renewals stay, belonging to nobody, and they come off every trip.'
        onDelete={() => api.request(deletePerson, { params: { personId } })}
      />
    </div>
  )
}
