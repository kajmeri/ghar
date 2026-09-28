'use client'

import { createPerson, deletePerson, updatePerson } from '@ghar/contracts'
import type { CalendarDate } from '@ghar/core/dates'
import { EARLIEST_BIRTH_DATE, PERSON_NAME_MAX_LENGTH } from '@ghar/core/people'
import { UserPlus } from 'lucide-react'
import { useId, useState, type SyntheticEvent } from 'react'
import { DateField } from '@/app/(app)/_components/ui/date-field'
import { DeleteButton } from '@/app/(app)/_components/ui/delete-button'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { formText } from '@/lib/form'

const BIRTH_DATE_HINT = 'Optional. Ghar uses ages to suggest what to pack, like a car seat.'

/** Adds someone without an account. The fields clear once they're in. */
export function AddPersonForm({ today }: { today: CalendarDate }) {
  const [key, setKey] = useState(0)
  const birthDateId = useId()
  const add = useMutation(async (body: { name: string; birthDate: string }) => {
    await api.request(createPerson, { body })
    setKey(value => value + 1)
  })

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    add.mutate({ name: formText(data, 'name'), birthDate: formText(data, 'birthDate') })
  }

  return (
    <form key={key} onSubmit={onSubmit} className='flex flex-col gap-3 rounded-card border border-line bg-surface p-4'>
      <div className='flex flex-col gap-3 md:flex-row md:items-start'>
        <Field label='Name' className='md:flex-1'>
          <Input name='name' required maxLength={PERSON_NAME_MAX_LENGTH} autoComplete='off' />
        </Field>
        <DateField
          id={birthDateId}
          name='birthDate'
          label='Birth date'
          hint={BIRTH_DATE_HINT}
          min={EARLIEST_BIRTH_DATE}
          max={today}
          className='md:flex-1'
        />
      </div>
      <div>
        <Button type='submit' disabled={add.pending}>
          <UserPlus aria-hidden />
          {add.pending ? 'Adding…' : 'Add person'}
        </Button>
      </div>
      <FormError>{add.error}</FormError>
    </form>
  )
}

/** Edit or remove someone without an account. */
export function PersonControls({
  personId,
  name,
  birthDate,
  today,
}: {
  personId: string
  name: string
  birthDate: CalendarDate | null
  today: CalendarDate
}) {
  const [editing, setEditing] = useState(false)
  const birthDateId = useId()
  const save = useMutation(async (body: { name: string; birthDate: string }) => {
    await api.request(updatePerson, { params: { personId }, body })
    setEditing(false)
  })

  if (editing) {
    const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      save.mutate({ name: formText(data, 'name'), birthDate: formText(data, 'birthDate') })
    }
    return (
      <form onSubmit={onSubmit} className='mt-4 flex flex-col gap-3 border-t border-line pt-4'>
        <div className='flex flex-col gap-3 md:flex-row md:items-start'>
          <Field label='Name' className='md:flex-1'>
            <Input name='name' required maxLength={PERSON_NAME_MAX_LENGTH} defaultValue={name} autoComplete='off' autoFocus />
          </Field>
          <DateField
            id={birthDateId}
            name='birthDate'
            label='Birth date'
            hint={BIRTH_DATE_HINT}
            defaultValue={birthDate ?? undefined}
            min={EARLIEST_BIRTH_DATE}
            max={today}
            className='md:flex-1'
          />
        </div>
        <div className='flex gap-2'>
          <Button type='submit' disabled={save.pending}>
            {save.pending ? 'Saving…' : 'Save changes'}
          </Button>
          <Button
            type='button'
            variant='ghost'
            onClick={() => {
              save.clearError()
              setEditing(false)
            }}
          >
            Cancel
          </Button>
        </div>
        <FormError>{save.error}</FormError>
      </form>
    )
  }

  return (
    <div className='mt-4 flex flex-wrap gap-2 border-t border-line pt-4'>
      <Button
        variant='outline'
        onClick={() => {
          setEditing(true)
        }}
      >
        Edit<span className='sr-only'> {name}</span>
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

/**
 * A member's birth date, on their card. Their name lives on their profile, so this is all there is
 * to edit here. Emptying the field and saving clears it.
 */
export function BirthDateControl({
  personId,
  name,
  birthDate,
  today,
}: {
  personId: string
  name: string
  birthDate: CalendarDate | null
  today: CalendarDate
}) {
  const [editing, setEditing] = useState(false)
  const birthDateId = useId()
  const save = useMutation(async (next: string) => {
    await api.request(updatePerson, { params: { personId }, body: { birthDate: next } })
    setEditing(false)
  })

  if (!editing) {
    return (
      <Button
        variant='outline'
        onClick={() => {
          setEditing(true)
        }}
      >
        {birthDate === null ? 'Add birth date' : 'Change birth date'}
        <span className='sr-only'> for {name}</span>
      </Button>
    )
  }

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    save.mutate(formText(new FormData(event.currentTarget), 'birthDate'))
  }

  return (
    <form onSubmit={onSubmit} className='flex w-full flex-col gap-3'>
      <DateField
        id={birthDateId}
        name='birthDate'
        label='Birth date'
        hint={BIRTH_DATE_HINT}
        defaultValue={birthDate ?? undefined}
        min={EARLIEST_BIRTH_DATE}
        max={today}
        className='md:max-w-xs'
      />
      <div className='flex gap-2'>
        <Button type='submit' disabled={save.pending}>
          {save.pending ? 'Saving…' : 'Save changes'}
        </Button>
        <Button
          type='button'
          variant='ghost'
          onClick={() => {
            save.clearError()
            setEditing(false)
          }}
        >
          Cancel
        </Button>
      </div>
      <FormError>{save.error}</FormError>
    </form>
  )
}
