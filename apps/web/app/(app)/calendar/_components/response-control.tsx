'use client'

import type { AttendeeResponse } from '@ghar/core/calendar'
import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { FormMessage } from '@/components/ui/field'
import { IDLE } from '@/lib/actions/state'
import { RESPONSE_LABELS } from '@/lib/calendar/display'
import { respondToEventAction } from '../actions'

const CHOICES = ['accepted', 'tentative', 'declined'] as const satisfies AttendeeResponse[]

/** The signed-in person's answer. Each button submits its own value. */
export function ResponseControl({ eventId, response }: { eventId: string; response: AttendeeResponse }) {
  const [state, formAction, pending] = useActionState(respondToEventAction, IDLE)

  return (
    <form action={formAction} className='flex flex-col gap-3'>
      <input type='hidden' name='eventId' value={eventId} />
      <p id='response-label' className='text-sm font-medium text-ink'>
        Are you going?
      </p>
      <div role='group' aria-labelledby='response-label' className='grid grid-cols-3 gap-2'>
        {CHOICES.map(choice => (
          <Button
            key={choice}
            type='submit'
            name='response'
            value={choice}
            variant={response === choice ? 'default' : 'outline'}
            aria-pressed={response === choice}
            disabled={pending}
          >
            {RESPONSE_LABELS[choice]}
          </Button>
        ))}
      </div>
      <FormMessage state={state} />
    </form>
  )
}
