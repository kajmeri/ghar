'use client'

import { dismissScaffold, scaffoldDay } from '@ghar/contracts'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { useItinerary } from './itinerary-context'

/** An empty day offers the usual shape of a day, so filling it in is choosing, not typing. */
export function ScaffoldOffer({ day }: { day: string }) {
  const { tripId } = useItinerary()
  const scaffold = useMutation(() => api.request(scaffoldDay, { params: { tripId }, body: { day } }))
  const dismiss = useMutation(() => api.request(dismissScaffold, { params: { tripId }, body: { day } }))
  const pending = scaffold.pending || dismiss.pending

  return (
    <div className='my-2 flex flex-col gap-3 rounded-card border border-dashed border-line p-4'>
      <p className='text-sm text-ink-muted'>
        Nothing planned. Lay out breakfast, lunch and dinner with a morning, afternoon and evening, and fill them in as you decide.
      </p>
      <div className='flex flex-wrap gap-2'>
        <Button
          variant='outline'
          disabled={pending}
          onClick={() => {
            scaffold.mutate()
          }}
        >
          {scaffold.pending ? 'Laying it out…' : 'Lay out the day'}
        </Button>
        <Button
          variant='ghost'
          disabled={pending}
          onClick={() => {
            dismiss.mutate()
          }}
        >
          Not this day
        </Button>
      </div>
      <FormError>{scaffold.error ?? dismiss.error}</FormError>
    </div>
  )
}
