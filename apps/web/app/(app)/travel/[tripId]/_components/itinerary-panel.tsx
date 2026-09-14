import type { HouseholdMember, TripDetail, TripIdea } from '@ghar/contracts'
import { chosenOptionOf, compareSlots } from '@ghar/core/itinerary'
import { positioned, type Density } from '@/lib/travel/itinerary-display'
import { ItineraryProvider } from './itinerary-context'
import { ItineraryToolbar, type ItineraryLayout } from './itinerary-toolbar'
import { LinkedBookings } from './linked-bookings'
import { SlotSheets } from './slot-sheet'
import { StopMap, type MapStop } from './stop-map'
import { Timeline } from './timeline'
import { WeekGrid } from './week-grid'

/**
 * The itinerary. The day timeline is the default and the only layout on a phone: one line
 * per slot, with the undecided ones opening in place. A wide screen can also lay the trip out
 * as a week to rearrange it, and has room for the stops beside the timeline.
 */
export function ItineraryPanel({
  detail,
  ideas,
  currentUserId,
  canEdit,
  density,
  layout,
}: {
  detail: TripDetail
  ideas: readonly TripIdea[]
  currentUserId: string
  canEdit: boolean
  density: Density
  layout: ItineraryLayout
}) {
  const { trip, itinerary, bookings, timeZone, today } = detail
  const members: readonly HouseholdMember[] = detail.members

  const stops: MapStop[] = itinerary.slots
    .map(positioned)
    .sort(compareSlots)
    .flatMap(({ slot }) => {
      const option = chosenOptionOf(slot)
      return option && option.lat !== null && option.lng !== null
        ? [{ id: option.id, title: option.title, lat: option.lat, lng: option.lng }]
        : []
    })

  // A booking is on the itinerary once an option was made from it.
  const listed = new Set(itinerary.slots.flatMap(slot => slot.options.map(option => option.bookingId)))
  const unlistedBookingCount = bookings.filter(booking => !listed.has(booking.id)).length

  return (
    <ItineraryProvider
      trip={trip}
      timeZone={timeZone}
      today={today}
      itinerary={itinerary}
      members={members}
      ideas={ideas}
      currentUserId={currentUserId}
      canEdit={canEdit}
      density={density}
    >
      <div className='flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8'>
        <div className='flex min-w-0 flex-1 flex-col gap-4'>
          <ItineraryToolbar layout={layout} unlistedBookingCount={unlistedBookingCount} />
          {layout === 'week' ? (
            <>
              <WeekGrid className='hidden md:flex' />
              <Timeline className='md:hidden' />
            </>
          ) : (
            <Timeline />
          )}
          <LinkedBookings tripId={trip.id} bookings={bookings} timeZone={timeZone} />
        </div>

        {layout === 'week' ? null : <StopMap stops={stops} className='hidden lg:block lg:w-80 lg:shrink-0' />}
      </div>
      <SlotSheets />
    </ItineraryProvider>
  )
}
