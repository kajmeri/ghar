import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { GUEST_STATUS_LABELS, GUEST_STATUS_TONES, SharedTripFrame, tripWhen } from '@/app/_components/shared-trip'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Pill } from '@/components/ui/pill'
import { getMembership, getSessionContext } from '@/lib/auth/context'
import * as guests from '@/lib/travel/guests'

// Trips other households let this account onto. It works with no household at all: someone who
// only came for a friend's trip lands here, not in onboarding, and can start a household later
// without losing any of it.

export const metadata: Metadata = { title: 'Shared with you' }

export default async function SharedTripsPage() {
  const session = await getSessionContext()
  if (!session) redirect('/login?next=/shared')
  const [trips, membership] = await Promise.all([guests.listSharedTrips(session), getMembership(session)])

  return (
    <SharedTripFrame home={membership ? '/' : '/shared'}>
      <div className='flex flex-col gap-6'>
        <div className='flex flex-col gap-1'>
          <h1 className='text-2xl font-semibold'>Shared with you</h1>
          <p className='text-base text-ink-muted'>Trips other households invited you on.</p>
        </div>

        {trips.length === 0 ? (
          <EmptyState title='No trips yet'>When someone invites you on a trip and lets you in, it shows up here.</EmptyState>
        ) : (
          <ul className='flex flex-col gap-3'>
            {trips.map(trip => (
              <li key={trip.id}>
                <Link
                  href={`/shared/${trip.id}`}
                  className='flex flex-col gap-1 rounded-card border border-line bg-surface p-4 hover:border-ink/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'
                >
                  <span className='flex items-start justify-between gap-3'>
                    <span className='text-lg font-semibold'>{trip.name}</span>
                    <Pill tone={GUEST_STATUS_TONES[trip.mine.status]} className='mt-1'>
                      {GUEST_STATUS_LABELS[trip.mine.status]}
                    </Pill>
                  </span>
                  <span className='text-sm text-ink-muted tabular-nums'>
                    {[trip.destination, tripWhen(trip)].filter(Boolean).join(' · ')}
                  </span>
                  <span className='text-sm text-ink-muted'>With {trip.householdName}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {membership ? (
          <Button asChild variant='outline'>
            <Link href='/travel'>Back to your trips</Link>
          </Button>
        ) : (
          <section aria-labelledby='start-heading' className='flex flex-col gap-3 rounded-card border border-line bg-surface p-4'>
            <div className='flex flex-col gap-1'>
              <h2 id='start-heading' className='text-lg font-semibold'>
                Start your own household
              </h2>
              <p className='text-base text-ink-muted'>
                Keep your own trips, money and documents in Ghar. Trips shared with you stay right here.
              </p>
            </div>
            <Button asChild>
              <Link href='/onboarding'>Start your household</Link>
            </Button>
          </section>
        )}
      </div>
    </SharedTripFrame>
  )
}
