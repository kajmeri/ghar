'use client'

import { updateMyHousehold } from '@ghar/contracts'
import { useState, type SyntheticEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Select } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { formText } from '@/lib/form'

const TIME_ZONE_HINT = 'Dates, reminders and the morning email all follow it.'
const COUNTRY_HINT = 'Ghar uses it to tell which trips go abroad, so it can remind you about passports.'

/**
 * Where the household is: its time zone and home country, for owners and adults. Saved through the
 * same endpoint the phone uses.
 */
export function PlaceForm({
  timezone,
  timeZones,
  homeCountry,
  countries,
}: {
  timezone: string
  timeZones: string[]
  homeCountry: string | null
  countries: { code: string; label: string }[]
}) {
  const [saved, setSaved] = useState(false)
  const save = useMutation(async (body: { timezone: string; homeCountry: string }) => {
    await api.request(updateMyHousehold, { body })
    setSaved(true)
  })

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaved(false)
    const data = new FormData(event.currentTarget)
    save.mutate({ timezone: formText(data, 'timezone'), homeCountry: formText(data, 'homeCountry') })
  }

  return (
    <form
      onSubmit={onSubmit}
      onChange={() => {
        setSaved(false)
      }}
      className='flex flex-col gap-3 rounded-card border border-line bg-surface p-4'
    >
      <Field label='Time zone' hint={TIME_ZONE_HINT}>
        <Select name='timezone' defaultValue={timezone}>
          {timeZones.map(zone => (
            <option key={zone} value={zone}>
              {zone.replaceAll('_', ' ')}
            </option>
          ))}
        </Select>
      </Field>
      <Field label='Home country' hint={COUNTRY_HINT}>
        <Select name='homeCountry' defaultValue={homeCountry ?? ''}>
          <option value=''>Not set</option>
          {countries.map(country => (
            <option key={country.code} value={country.code}>
              {country.label}
            </option>
          ))}
        </Select>
      </Field>
      <FormError>{save.error}</FormError>
      <div className='flex items-center gap-3'>
        <Button type='submit' variant='outline' disabled={save.pending}>
          {save.pending ? 'Saving…' : 'Save changes'}
        </Button>
        <p role='status' className='text-sm text-ink-muted'>
          {saved && !save.pending ? 'Saved' : ''}
        </p>
      </div>
    </form>
  )
}
