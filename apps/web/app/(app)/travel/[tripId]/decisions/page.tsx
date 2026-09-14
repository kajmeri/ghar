import { can } from '@ghar/core/auth'
import { NotFoundError } from '@ghar/core/errors'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPageSession } from '@/lib/api/authed'
import { loadTripDecisions, loadTripIdeas } from '@/lib/travel/trips'
import { ItineraryProvider } from '../_components/itinerary-context'
import { SlotSheets } from '../_components/slot-sheet'
import { DecisionQueue } from './_components/decision-queue'

export const metadata = { title: 'Decisions' }

/** What is still open on a trip, most pressing first, so a spare ten minutes settles the lot. */
export default async function DecisionsPage({ params }: { params: Promise<{ tripId: string }> }) {
  const session = await getPageSession()
  const { tripId } = await params

  const [queue, ideas] = await Promise.all([
    loadTripDecisions(session, tripId).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound()
      throw error
    }),
    loadTripIdeas(session),
  ])
  const { userId, role } = session.context
  const { trip } = queue

  return (
    <div className='flex flex-col gap-6'>
      <header className='flex flex-col gap-3'>
        <Link href={`/travel/${trip.id}`} className='text-sm text-ink-muted underline underline-offset-4'>
          {trip.name}
        </Link>
        <div>
          <h1 className='text-2xl font-semibold'>Decisions</h1>
          <p className='mt-1 text-sm text-ink-muted'>
            {queue.decisions.length === 0
              ? 'All settled.'
              : `${queue.decisions.length} still open. Reservation deadlines first, then whatever comes soonest.`}
          </p>
        </div>
      </header>

      <ItineraryProvider
        trip={trip}
        timeZone={queue.timeZone}
        today={queue.today}
        itinerary={queue.itinerary}
        members={queue.members}
        ideas={ideas}
        currentUserId={userId}
        canEdit={can(role, 'travel.manage')}
      >
        <DecisionQueue decisions={queue.decisions} />
        <SlotSheets />
      </ItineraryProvider>
    </div>
  )
}
