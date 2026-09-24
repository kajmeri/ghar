import type { SharedDay, SharedSlot } from '@ghar/contracts'
import { formatCalendarDate, formatInstant } from '@ghar/core/dates'
import { mapLink, slotTimeLabel } from '@/lib/travel/itinerary-display'
import { SlotChoices } from './slot-choices'

/**
 * The plan as a guest reads it: what's decided and when, day by day, and a vote on what isn't
 * yet. Nothing about money or bookings. Times are the host's, since that's where the trip happens.
 */
export function TripPlan({
  tripId,
  days,
  timeZone,
  householdName,
}: {
  tripId: string
  days: SharedDay[]
  timeZone: string
  householdName: string
}) {
  return (
    <section aria-labelledby='plan-heading' className='flex flex-col gap-3'>
      <div className='flex flex-col gap-1'>
        <h2 id='plan-heading' className='text-lg font-semibold'>
          The plan
        </h2>
        {days.length > 0 ? <p className='text-sm text-ink-muted'>Times are {zoneName(timeZone)} time.</p> : null}
      </div>
      {days.length === 0 ? (
        <div className='rounded-card border border-dashed border-line px-4 py-6'>
          <p className='text-base font-medium'>Nothing planned yet</p>
          <p className='text-sm text-ink-muted'>
            Plans from {householdName} show up here as they’re made, and in your calendar if you add it.
          </p>
        </div>
      ) : (
        <ol className='flex flex-col gap-3'>
          {days.map(day => (
            <li key={day.day} className='flex flex-col gap-1 rounded-card border border-line bg-surface p-4'>
              <h3 className='text-base font-semibold'>{formatCalendarDate(day.day, 'EEEE, MMM d')}</h3>
              <ul className='flex flex-col divide-y divide-line'>
                {day.slots.map(slot => (
                  <PlanRow key={slot.id} tripId={tripId} slot={slot} timeZone={timeZone} />
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

const LINK = 'flex min-h-tap w-fit items-center text-sm text-ink underline underline-offset-2'

function PlanRow({ tripId, slot, timeZone }: { tripId: string; slot: SharedSlot; timeZone: string }) {
  const until = slot.endsAt === null ? '' : `–${formatInstant(new Date(slot.endsAt), timeZone, { timeStyle: 'short' })}`
  const heading = slot.title === null ? slot.label : slot.title === slot.label ? slot.title : `${slot.label}: ${slot.title}`
  const map = slot.address ? mapLink({ address: slot.address, lat: null, lng: null }) : null
  const website = slot.url && isWebUrl(slot.url) ? slot.url : null

  return (
    <li className='flex flex-col gap-2 py-3'>
      <div className='flex gap-3'>
        <span className='w-20 shrink-0 text-sm text-ink-muted tabular-nums'>
          {slotTimeLabel(slot, timeZone)}
          {until}
        </span>
        <div className='flex min-w-0 flex-col gap-0.5'>
          <p className='text-base break-words'>{heading}</p>
          {slot.state === 'deciding' ? (
            <p className='text-sm text-ink-muted tabular-nums'>
              {slot.decideBy ? `Still deciding, by ${formatCalendarDate(slot.decideBy, 'EEE, MMM d')}` : 'Still deciding'}
            </p>
          ) : null}
          {slot.subtitle ? <p className='text-sm text-ink-muted break-words'>{slot.subtitle}</p> : null}
          {slot.address ? <p className='text-sm break-words text-ink-muted'>{slot.address}</p> : null}
          {map || website ? (
            <div className='flex gap-4'>
              {map ? (
                <a href={map} target='_blank' rel='noreferrer' className={LINK}>
                  Map
                </a>
              ) : null}
              {website ? (
                <a href={website} target='_blank' rel='noreferrer' className={LINK}>
                  Website
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {slot.state === 'deciding' && slot.choices.length > 0 ? (
        <SlotChoices tripId={tripId} slotId={slot.id} label={slot.label} choices={slot.choices} />
      ) : null}
    </li>
  )
}

/** "Asia/Kolkata" reads as "Kolkata". */
function zoneName(timeZone: string): string {
  return (timeZone.split('/').at(-1) ?? timeZone).replaceAll('_', ' ')
}

/** The household typed it, so only follow http(s). */
function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}
