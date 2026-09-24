'use client'

import { generateItineraryFromBookings } from '@ghar/contracts'
import { isOpenDecision } from '@ghar/core/itinerary'
import { ListChecks, Plus, Printer } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { DensityToggle } from './density-toggle'
import { useItinerary } from './itinerary-context'

export type ItineraryLayout = 'timeline' | 'week'

export function ItineraryToolbar({ layout, unlistedBookingCount }: { layout: ItineraryLayout; unlistedBookingCount: number }) {
  const { tripId, slots, days, today, canEdit, openSheet } = useItinerary()
  const generate = useMutation(() => api.request(generateItineraryFromBookings, { params: { tripId }, body: {} }))
  const openCount = slots.filter(isOpenDecision).length
  const firstDay = days.find(day => day >= today) ?? days[0] ?? today

  return (
    <div className='flex flex-col gap-2 print:hidden'>
      <div className='flex flex-wrap items-center gap-2'>
        {canEdit ? (
          <Button
            variant='outline'
            onClick={() => {
              openSheet({ kind: 'add-slot', day: firstDay })
            }}
          >
            <Plus aria-hidden className='size-4' />
            Add a slot
          </Button>
        ) : null}
        <Button asChild variant='ghost'>
          <Link href={`/travel/${tripId}/decisions`}>
            <ListChecks aria-hidden className='size-4' />
            Decisions
            {openCount > 0 ? <span className='text-caution-ink tabular-nums'>{openCount}</span> : null}
          </Link>
        </Button>
        <Button asChild variant='ghost'>
          <Link href={`/travel/${tripId}/sheet`}>
            <Printer aria-hidden className='size-4' />
            Day sheet
          </Link>
        </Button>
        {canEdit && unlistedBookingCount > 0 ? (
          <Button
            variant='ghost'
            disabled={generate.pending}
            onClick={() => {
              generate.mutate()
            }}
          >
            {generate.pending ? 'Adding…' : `Add ${unlistedBookingCount} booking${unlistedBookingCount === 1 ? '' : 's'} to the days`}
          </Button>
        ) : null}

        <div className='ml-auto flex items-center gap-2'>
          <nav aria-label='Itinerary layout' className='hidden overflow-hidden rounded-control border border-line bg-surface md:flex'>
            <LayoutLink href={`/travel/${tripId}?tab=itinerary`} active={layout === 'timeline'}>
              Timeline
            </LayoutLink>
            <LayoutLink href={`/travel/${tripId}?tab=itinerary&view=week`} active={layout === 'week'} className='border-l border-line'>
              Week
            </LayoutLink>
          </nav>
          <div className={cn(layout === 'week' && 'md:hidden')}>
            <DensityToggle />
          </div>
        </div>
      </div>
      <FormError>{generate.error}</FormError>
    </div>
  )
}

function LayoutLink({ href, active, className, children }: { href: string; active: boolean; className?: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-tap items-center px-3 text-sm focus-visible:-outline-offset-2',
        active ? 'bg-paper font-medium text-ink' : 'text-ink-muted hover:bg-paper',
        className
      )}
    >
      {children}
    </Link>
  )
}
