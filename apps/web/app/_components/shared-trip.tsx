import type { GuestStatusValue, TripInvitePreview } from '@ghar/contracts'
import { formatTripDates } from '@ghar/core/trips'
import Link from 'next/link'
import type { ReactNode } from 'react'
import type { PillTone } from '@/components/ui/pill'
import { GharMark } from './ghar-mark'

// A trip as someone outside its household sees it: on the invitation, and on the trips shared with
// them. The cover photo is the trip's personality; without one it's the name and the dates, set
// large. Nothing here is money, notes or bookings.

type Basics = TripInvitePreview['trip']
type Going = TripInvitePreview['going']

/** The page around an invitation or a shared trip. Works without a household, signed in or out. */
export function SharedTripFrame({ children, home = '/' }: { children: ReactNode; home?: string }) {
  return (
    <main className='mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pt-[max(--spacing(6),env(safe-area-inset-top))] pb-[max(--spacing(12),env(safe-area-inset-bottom))] md:pt-12'>
      <Link href={home} className='mb-6 flex min-h-tap w-fit items-center gap-2 text-lg font-semibold text-ink'>
        <GharMark />
        Ghar
      </Link>
      {children}
    </main>
  )
}

export function tripWhen(trip: Pick<Basics, 'startsOn' | 'endsOn'>): string {
  return trip.startsOn ? formatTripDates(trip) : 'Dates to be decided'
}

export function SharedTripHero({ trip, eyebrow }: { trip: Basics; eyebrow?: ReactNode }) {
  return (
    <header className='flex flex-col gap-4'>
      {trip.coverImageUrl ? (
        <img
          src={trip.coverImageUrl}
          alt=''
          width={800}
          height={450}
          referrerPolicy='no-referrer'
          decoding='async'
          className='aspect-[16/9] w-full rounded-card border border-line bg-line/40 object-cover'
        />
      ) : null}
      <div className='flex flex-col gap-1'>
        {eyebrow ? <p className='text-sm text-ink-muted'>{eyebrow}</p> : null}
        <h1 className='text-[length:clamp(var(--text-2xl),8vw,var(--text-3xl))] leading-tight font-semibold tracking-[-0.02em] text-balance'>
          {trip.name}
        </h1>
        <p className='text-base text-ink-muted tabular-nums'>{[trip.destination, tripWhen(trip)].filter(Boolean).join(' · ')}</p>
      </div>
    </header>
  )
}

/** "Asha, Sam and 3 more" with the counts beside it. Names are first names only. */
export function WhoIsGoing({ going }: { going: Going }) {
  const { names, headcount } = going
  const shown = names.slice(0, 3)
  const others = headcount.going - shown.length
  const list =
    shown.length === 0
      ? 'Nobody has said yes yet'
      : others > 0
        ? `${shown.join(', ')} and ${String(others)} more`
        : shown.length === 1
          ? (shown[0] ?? '')
          : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1) ?? ''}`

  return (
    <section aria-labelledby='going-heading' className='flex flex-col gap-1 rounded-card border border-line bg-surface p-4'>
      <h2 id='going-heading' className='text-sm font-medium text-ink'>
        Who’s going
      </h2>
      <p className='text-base text-ink'>{list}</p>
      <p className='text-sm text-ink-muted tabular-nums'>
        {headcount.going} going{headcount.maybe > 0 ? ` · ${String(headcount.maybe)} maybe` : ''}
      </p>
    </section>
  )
}

export function SharedTripSkeleton({ label }: { label: string }) {
  return (
    <SharedTripFrame>
      <div aria-busy='true' className='flex flex-col gap-6'>
        <p role='status' className='sr-only'>
          {label}
        </p>
        <div aria-hidden className='flex flex-col gap-6'>
          <div className='flex flex-col gap-2'>
            <span className='h-4 w-40 rounded-pill bg-line/60' />
            <span className='h-8 w-64 max-w-full rounded-pill bg-line' />
            <span className='h-4 w-48 rounded-pill bg-line/60' />
          </div>
          <span className='block h-24 rounded-card border border-line bg-surface' />
          <span className='block h-56 rounded-card border border-line bg-surface' />
        </div>
      </div>
    </SharedTripFrame>
  )
}

export const GUEST_STATUS_LABELS: Record<GuestStatusValue, string> = {
  invited: 'Not answered',
  asked: 'Waiting to be let in',
  going: 'Going',
  maybe: 'Maybe',
  not_going: 'Can’t go',
}

/** Colour only where it says something: in and coming, or waiting on the household. */
export const GUEST_STATUS_TONES: Record<GuestStatusValue, PillTone> = {
  invited: 'neutral',
  asked: 'caution',
  going: 'positive',
  maybe: 'neutral',
  not_going: 'neutral',
}
