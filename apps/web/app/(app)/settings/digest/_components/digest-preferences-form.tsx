'use client'

import type { DigestSectionName } from '@ghar/contracts'
import { useActionState } from 'react'
import { CheckboxField } from '@/app/(app)/_components/ui/checkbox-field'
import { Button } from '@/components/ui/button'
import { FormMessage } from '@/components/ui/field'
import { fieldError, IDLE } from '@/lib/actions/state'
import { saveDigestPreferencesAction, sendDigestPreviewAction } from '../actions'

export function DigestPreferencesForm({
  enabled,
  chosen,
  sections,
}: {
  enabled: boolean
  chosen: DigestSectionName[]
  sections: { value: DigestSectionName; title: string; description: string }[]
}) {
  const [state, formAction, pending] = useActionState(saveDigestPreferencesAction, IDLE)
  const sectionsError = fieldError(state, 'sections')

  return (
    <form action={formAction} className='flex flex-col gap-6'>
      <div className='rounded-card border border-line bg-surface px-4'>
        <CheckboxField
          name='enabled'
          label='Send me the daily email'
          hint='It comes once a day, in the morning. A day with nothing to say sends nothing.'
          defaultChecked={enabled}
        />
      </div>

      <fieldset aria-describedby={sectionsError ? 'sections-error' : undefined}>
        <legend className='mb-1.5 text-sm font-medium text-ink'>What’s in it</legend>
        <div className='divide-y divide-line rounded-card border border-line bg-surface px-4'>
          {sections.map(section => (
            <CheckboxField
              key={section.value}
              name='sections'
              value={section.value}
              label={section.title}
              hint={section.description}
              defaultChecked={chosen.includes(section.value)}
            />
          ))}
        </div>
        {sectionsError ? (
          <p id='sections-error' className='mt-1.5 text-sm text-negative'>
            {sectionsError}
          </p>
        ) : null}
      </fieldset>

      <div className='flex flex-col gap-2'>
        <Button type='submit' disabled={pending} className='self-start'>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  )
}

export function DigestPreviewForm() {
  const [state, formAction, pending] = useActionState(sendDigestPreviewAction, IDLE)
  return (
    <form action={formAction} className='flex flex-col gap-2'>
      <Button type='submit' variant='outline' disabled={pending} className='self-start'>
        {pending ? 'Sending…' : 'Send me today’s email'}
      </Button>
      <FormMessage state={state} />
    </form>
  )
}
