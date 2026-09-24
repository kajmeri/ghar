import { NotFoundError } from '@ghar/core/errors'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { GUEST_STATUS_LABELS, GUEST_STATUS_TONES, SharedTripFrame, SharedTripHero } from '@/app/_components/shared-trip'
import { TripAnswerForm } from '@/app/_components/trip-answer-form'
import { TripPolls } from '@/app/_components/trip-polls'
import { Pill } from '@/components/ui/pill'
import { getMembership, getSessionContext } from '@/lib/auth/context'
import * as guests from '@/lib/travel/guests'
import * as polls from '@/lib/travel/polls'
import { updateMyAnswerAction } from '../actions'
import { CalendarFeed } from './_components/calendar-feed'
import { TripPeople } from './_components/trip-people'
import { TripPlan } from './_components/trip-plan'

// One trip as a guest sees it: who's going, the plan as it's decided, and their own answer. The
// household's own members open it under Travel instead.

// The calendar link on this page is a bearer secret, so it never leaves through Referer.
export const metadata: Metadata = { title: 'Shared trip', referrer: 'no-referrer' }

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
        <TripPeople people={trip.people} householdName={trip.householdName} />
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
        <TripPolls tripId={trip.id} value={await polls.listTripPolls(session, trip.id)} offer={[]} />
        <TripPlan tripId={trip.id} days={trip.itinerary} timeZone={trip.timeZone} householdName={trip.householdName} />
        <section aria-labelledby='calendar-heading' className='flex flex-col gap-3 rounded-card border border-line bg-surface p-4'>
          <h2 id='calendar-heading' className='text-lg font-semibold'>
            In your calendar
          </h2>
          <CalendarFeed tripId={trip.id} feed={trip.calendarFeed} />
        </section>
        <p className='text-sm text-ink-muted'>Costs, bookings and notes stay with {trip.householdName}.</p>
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
