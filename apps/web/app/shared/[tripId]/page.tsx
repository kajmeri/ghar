import { NotFoundError } from '@ghar/core/errors'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { GUEST_STATUS_LABELS, GUEST_STATUS_TONES, SharedTripFrame, SharedTripHero, WhoIsGoing } from '@/app/_components/shared-trip'
import { TripAnswerForm } from '@/app/_components/trip-answer-form'
import { Pill } from '@/components/ui/pill'
import { getMembership, getSessionContext } from '@/lib/auth/context'
import * as guests from '@/lib/travel/guests'
import { updateMyAnswerAction } from '../actions'

// One trip as a guest sees it. The household's own members open it under Travel instead.

export const metadata: Metadata = { title: 'Shared trip' }

export default async function SharedTripPage({ params }: PageProps<'/shared/[tripId]'>) {
  const { tripId } = await params
  const session = await getSessionContext()
  if (!session) redirect(`/login?next=${encodeURIComponent(`/shared/${tripId}`)}`)

  const [trip, membership] = await Promise.all([loadTrip(session, tripId), getMembership(session)])
  if (!trip) {
    // A member of the trip's own household lands on the trip itself.
    if (membership && (await guests.isHouseholdTrip(session, tripId))) redirect(`/travel/${tripId}`)
    notFound()
  }

  return (
    <SharedTripFrame home={membership ? '/' : '/shared'}>
      <div className='flex flex-col gap-6'>
        <Link href='/shared' className='-my-3 flex min-h-tap w-fit items-center text-sm text-ink-muted hover:text-ink'>
          ← Shared with you
        </Link>
        <SharedTripHero trip={trip} eyebrow={`With ${trip.householdName}`} />
        <WhoIsGoing going={trip.going} />
        <section aria-labelledby='answer-heading' className='flex flex-col gap-4 rounded-card border border-line bg-surface p-4'>
          <div className='flex items-center justify-between gap-3'>
            <h2 id='answer-heading' className='text-lg font-semibold'>
              Your answer
            </h2>
            <Pill tone={GUEST_STATUS_TONES[trip.mine.status]}>{GUEST_STATUS_LABELS[trip.mine.status]}</Pill>
          </div>
          <TripAnswerForm
            action={updateMyAnswerAction}
            hidden={{ tripId: trip.id }}
            signedIn
            defaultResponse={trip.mine.response}
            defaultPartySize={trip.mine.partySize}
            needsName={false}
            defaultEmail={null}
            submitLabel='Save answer'
          />
        </section>
        <p className='text-sm text-ink-muted'>The plan, bookings and everything else about the trip stay with {trip.householdName}.</p>
      </div>
    </SharedTripFrame>
  )
}

async function loadTrip(session: NonNullable<Awaited<ReturnType<typeof getSessionContext>>>, tripId: string) {
  try {
    return await guests.getSharedTrip(session, tripId)
  } catch (error) {
    if (error instanceof NotFoundError) return null
    throw error
  }
}
