'use client'

import { updateMyHousehold } from '@ghar/contracts'
import { useState, type SyntheticEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Select } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { formText } from '@/lib/form'

const HINT = 'Dates, reminders and the morning email all follow it.'

/** The household's time zone, for owners and adults. Saved through the same endpoint the phone uses. */
export function TimeZoneForm({ timezone, timeZones }: { timezone: string; timeZones: string[] }) {
  const [saved, setSaved] = useState(false)
  const save = useMutation(async (zone: string) => {
    await api.request(updateMyHousehold, { body: { timezone: zone } })
    setSaved(true)
  })

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaved(false)
    save.mutate(formText(new FormData(event.currentTarget), 'timezone'))
  }

  return (
    <form onSubmit={onSubmit} className='flex flex-col gap-3 rounded-card border border-line bg-surface p-4'>
      <Field label='Time zone' hint={HINT}>
        <Select
          name='timezone'
          defaultValue={timezone}
          onChange={() => {
            setSaved(false)
          }}
        >
          {timeZones.map(zone => (
            <option key={zone} value={zone}>
              {zone.replaceAll('_', ' ')}
            </option>
          ))}
        </Select>
      </Field>
      <FormError>{save.error}</FormError>
      <div className='flex items-center gap-3'>
        <Button type='submit' variant='outline' disabled={save.pending}>
          {save.pending ? 'Saving…' : 'Save time zone'}
        </Button>
        <p role='status' className='text-sm text-ink-muted'>
          {saved && !save.pending ? 'Saved' : ''}
        </p>
      </div>
    </form>
  )
}
