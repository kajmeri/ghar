import type { TripGuestsValue } from '@ghar/contracts'
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { Pill } from '@/components/ui/pill'

/**
 * Who's coming from outside the household, one line on the trip page. It says what to do when
 * nobody's asked yet, and says so in colour when someone is waiting to be let in.
 */
export function GuestsSummary({ tripId, guests }: { tripId: string; guests: TripGuestsValue }) {
  const { headcount, canInvite } = guests
  const waiting = guests.guests.filter(guest => guest.status === 'asked').length
  if (guests.guests.length === 0 && !canInvite) return null

  const summary =
    guests.guests.length === 0
      ? 'Invite friends and family from outside the household.'
      : `${String(headcount.going)} going${headcount.maybe > 0 ? ` · ${String(headcount.maybe)} maybe` : ''}`

  return (
    <Link
      href={`/travel/${tripId}/guests`}
      className='flex min-h-tap items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3 hover:border-ink/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'
    >
      <span className='flex min-w-0 flex-col'>
        <span className='font-medium'>Who’s going</span>
        <span className='text-sm text-ink-muted tabular-nums'>{summary}</span>
      </span>
      <span className='flex shrink-0 items-center gap-2'>
        {waiting > 0 ? <Pill tone='caution'>{waiting} waiting</Pill> : null}
        <ChevronRight aria-hidden className='size-5 text-ink-muted' />
      </span>
    </Link>
  )
}
