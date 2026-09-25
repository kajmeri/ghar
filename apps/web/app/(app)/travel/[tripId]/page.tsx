import { can } from '@ghar/core/auth'
import { formatCountdown, formatTripDates, settleTripStatus, tripPhase } from '@ghar/core/trips'
import { NotFoundError } from '@ghar/core/errors'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { TripArrivals } from '@/app/_components/trip-arrivals'
import { TripCosts } from '@/app/_components/trip-costs'
import { TripPhotos } from '@/app/_components/trip-photos'
import { TripPolls } from '@/app/_components/trip-polls'
import { TripRecap } from '@/app/_components/trip-recap'
import { TripRooms } from '@/app/_components/trip-rooms'
import { TripUpdates } from '@/app/_components/trip-updates'
import { Pill } from '@/components/ui/pill'
import { getPageSession } from '@/lib/api/authed'
import { requireAccountSession } from '@/lib/auth/context'
import { densityCookieName, parseDensity } from '@/lib/travel/itinerary-display'
import { listTripArrivals, listTripRooms } from '@/lib/travel/arrivals'
import { listTripCosts } from '@/lib/travel/costs'
import { listTripGuests } from '@/lib/travel/guests'
import { getTripRecap, listTripPhotos } from '@/lib/travel/photos'
import { listTripPolls } from '@/lib/travel/polls'
import { listTripUpdates } from '@/lib/travel/updates'
import { loadTripBudget, loadTripDetail, loadTripIdeas } from '@/lib/travel/trips'
import { BudgetPanel } from './_components/budget-panel'
import { GuestsSummary } from './_components/guests-summary'
import { ItineraryPanel } from './_components/itinerary-panel'
import { PassportsCard } from './_components/passports-card'
import { PackingPanel } from './_components/packing-panel'
import { TripSettings } from './_components/trip-settings'
import { TripTabs, type TripTab } from './_components/trip-tabs'

export const metadata = { title: 'Trip' }

const TABS = ['itinerary', 'packing', 'budget'] as const

/**
 * One trip. The itinerary is the point of the page, so it is the tab you land on; packing
 * and budget are the other two things a trip needs and they get their own.
 *
 * The tab and the itinerary's layout are in the URL rather than in client state, so they
 * survive a refresh and can be linked to, and each panel is rendered on the server.
 */
export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string }>
  searchParams: Promise<{ tab?: string; view?: string }>
}) {
  const session = await getPageSession()
  const { tripId } = await params
  const { tab: requested, view } = await searchParams
  const tab: TripTab = TABS.find(value => value === requested) ?? 'itinerary'

  const account = requireAccountSession()
  const [detail, ideas, cookieStore, guests, polls, updates, arrivals, rooms, costs, photos, recap] = await Promise.all([
    loadTripDetail(session, tripId).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound()
      throw error
    }),
    tab === 'itinerary' ? loadTripIdeas(session) : Promise.resolve([]),
    cookies(),
    listTripGuests(session.context, tripId).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound()
      throw error
    }),
    account
      .then(signedIn => listTripPolls(signedIn, tripId))
      .catch((error: unknown) => {
        if (error instanceof NotFoundError) notFound()
        throw error
      }),
    account
      .then(signedIn => listTripUpdates(signedIn, tripId))
      .catch((error: unknown) => {
        if (error instanceof NotFoundError) notFound()
        throw error
      }),
    account
      .then(signedIn => listTripArrivals(signedIn, tripId))
      .catch((error: unknown) => {
        if (error instanceof NotFoundError) notFound()
        throw error
      }),
    account
      .then(signedIn => listTripRooms(signedIn, tripId))
      .catch((error: unknown) => {
        if (error instanceof NotFoundError) notFound()
        throw error
      }),
    account
      .then(signedIn => listTripCosts(signedIn, tripId))
      .catch((error: unknown) => {
        if (error instanceof NotFoundError) notFound()
        throw error
      }),
    account
      .then(signedIn => listTripPhotos(signedIn, tripId))
      .catch((error: unknown) => {
        if (error instanceof NotFoundError) notFound()
        throw error
      }),
    account
      .then(signedIn => getTripRecap(signedIn, tripId))
      .catch((error: unknown) => {
        if (error instanceof NotFoundError) notFound()
        throw error
      }),
  ])

  const { userId, role } = session.context
  const { trip, today } = detail
  const status = settleTripStatus(trip.status, trip, today)
  const phase = tripPhase(trip, today)
  const dates = formatTripDates(trip)

  return (
    <div className='flex flex-col gap-6'>
      <header className='flex flex-col gap-3'>
        <Link href='/travel' className='text-sm text-ink-muted underline underline-offset-4'>
          Travel
        </Link>

        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <div className='flex flex-wrap items-center gap-2'>
              <h1 className='text-2xl font-semibold'>{trip.name}</h1>
              <Pill tone={status === 'booked' ? 'positive' : 'neutral'}>{status}</Pill>
            </div>
            <p className='mt-1 text-sm text-ink-muted'>
              {[trip.destination, dates, formatCountdown(trip, today)].filter(Boolean).join(' · ')}
            </p>
          </div>

          <div className='flex flex-wrap items-center gap-2'>
            <TripSettings trip={trip} people={detail.people} currentUserId={userId} />
            {phase === 'current' || phase === 'upcoming' ? (
              <Button asChild variant={phase === 'current' ? 'default' : 'outline'}>
                <Link href={`/travel/${trip.id}/mode`}>Travel mode</Link>
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <GuestsSummary tripId={trip.id} guests={guests} />

      {phase === 'past' && recap ? <TripRecap recap={recap} canAddPhotos={photos.canAdd} /> : null}

      {phase === 'past' ? null : (
        <TripPolls
          tripId={trip.id}
          value={polls}
          offer={[...(trip.startsOn === null ? (['dates'] as const) : []), ...(trip.destination === null ? (['place'] as const) : [])]}
          today={today}
        />
      )}

      {trip.international && detail.documentIssues !== null && phase !== 'past' ? (
        <PassportsCard
          issues={detail.documentIssues}
          people={detail.people}
          travellerIds={trip.travellerIds}
          currentUserId={userId}
          today={today}
          canEdit={can(role, 'travel.manage')}
        />
      ) : null}

      <TripTabs tripId={trip.id} active={tab} />

      {tab === 'itinerary' ? (
        <ItineraryPanel
          detail={detail}
          ideas={ideas}
          currentUserId={userId}
          canEdit={can(role, 'travel.manage')}
          density={parseDensity(cookieStore.get(densityCookieName(userId))?.value)}
          layout={view === 'week' ? 'week' : 'timeline'}
        />
      ) : tab === 'packing' ? (
        <PackingPanel
          tripId={trip.id}
          items={detail.packing}
          members={detail.members}
          travellingUserIds={detail.people.flatMap(person =>
            person.userId !== null && trip.travellerIds.includes(person.id) ? [person.userId] : []
          )}
          currentUserId={userId}
        />
      ) : (
        <BudgetPanel
          budget={await loadTripBudget(session, trip.id)}
          tripName={trip.name}
          today={today}
          canSeeCharges={can(role, 'finances.manage')}
        />
      )}

      <TripArrivals tripId={trip.id} value={arrivals} timeZone={detail.timeZone} />
      <TripRooms tripId={trip.id} value={rooms} />
      {phase === 'current' || phase === 'past' || photos.photos.length > 0 ? <TripPhotos tripId={trip.id} value={photos} /> : null}
      <TripCosts tripId={trip.id} value={costs} today={today} />
      <TripUpdates tripId={trip.id} value={updates} timeZone={detail.timeZone} />
    </div>
  )
}
