import type { TripGuest } from '@ghar/contracts'
import { NotFoundError } from '@ghar/core/errors'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { GUEST_STATUS_LABELS, GUEST_STATUS_TONES } from '@/app/_components/shared-trip'
import { EmptyState } from '@/components/ui/empty-state'
import { Pill } from '@/components/ui/pill'
import { getPageSession } from '@/lib/api/authed'
import * as guests from '@/lib/travel/guests'
import { GuestControls } from './_components/guest-controls'
import { InviteGuestsForm } from './_components/invite-guests-form'
import { ShareLink } from './_components/share-link'

export const metadata = { title: 'Guests' }

/**
 * People from outside the household on a trip. They see the trip's name, dates, cover and who's
 * going, and answer; never the budget, the notes or the bookings. The household still decides.
 */
export default async function TripGuestsPage({ params }: { params: Promise<{ tripId: string }> }) {
  const session = await getPageSession()
  const { tripId } = await params
  const page = await guests.loadTripGuestsPage(session.context, tripId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound()
    throw error
  })
  const { headcount, canInvite } = page
  const waiting = page.guests.filter(guest => guest.status === 'asked').length

  return (
    <div className='flex flex-col gap-6'>
      <header className='flex flex-col gap-3'>
        <Link href={`/travel/${tripId}`} className='text-sm text-ink-muted underline underline-offset-4'>
          {page.tripName}
        </Link>
        <div>
          <h1 className='text-2xl font-semibold'>Guests</h1>
          <p className='mt-1 text-sm text-ink-muted tabular-nums'>
            {headcount.going} going{headcount.maybe > 0 ? ` · ${String(headcount.maybe)} maybe` : ''}
            {waiting > 0 ? ` · ${String(waiting)} waiting to be let in` : ''}
          </p>
        </div>
      </header>

      {canInvite ? (
        <div className='grid gap-6 md:grid-cols-2'>
          <section aria-labelledby='link-heading' className='flex flex-col gap-3 rounded-card border border-line bg-surface p-4 md:p-6'>
            <h2 id='link-heading' className='text-lg font-semibold'>
              Share a link
            </h2>
            <ShareLink tripId={tripId} link={page.link} />
          </section>
          <section aria-labelledby='invite-heading' className='flex flex-col gap-3 rounded-card border border-line bg-surface p-4 md:p-6'>
            <h2 id='invite-heading' className='text-lg font-semibold'>
              Invite by email
            </h2>
            <p className='text-base text-ink-muted'>People you invite by email are let in as soon as they answer.</p>
            <InviteGuestsForm tripId={tripId} />
          </section>
        </div>
      ) : null}

      <section aria-labelledby='list-heading' className='flex flex-col gap-3'>
        <h2 id='list-heading' className='text-lg font-semibold'>
          Who’s asked
        </h2>
        {page.guests.length === 0 ? (
          <EmptyState title='Nobody from outside the household yet'>
            {canInvite
              ? 'Share the link in a group chat, or invite people by email. They’ll show up here as they answer.'
              : 'An owner or adult can invite people from outside the household.'}
          </EmptyState>
        ) : (
          <ul className='flex flex-col divide-y divide-line rounded-card border border-line bg-surface'>
            {page.guests.map(guest => (
              <GuestRow key={guest.id} guest={guest} tripId={tripId} canInvite={canInvite} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function GuestRow({ guest, tripId, canInvite }: { guest: TripGuest; tripId: string; canInvite: boolean }) {
  const who = guest.name ?? guest.email
  const detail = [
    guest.name ? guest.email : null,
    guest.partySize > 1 ? `${String(guest.partySize)} people` : null,
    guest.source === 'link' ? 'Came through the link' : guest.invitedByName ? `Invited by ${guest.invitedByName}` : null,
  ].filter(Boolean)

  return (
    <li className='flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between'>
      <div className='flex min-w-0 flex-col gap-1'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='truncate font-medium'>{who}</span>
          <Pill tone={GUEST_STATUS_TONES[guest.status]}>{GUEST_STATUS_LABELS[guest.status]}</Pill>
        </div>
        {detail.length > 0 ? <p className='truncate text-sm text-ink-muted tabular-nums'>{detail.join(' · ')}</p> : null}
      </div>
      {canInvite ? <GuestControls tripId={tripId} guestId={guest.id} who={who} waiting={guest.status === 'asked'} /> : null}
    </li>
  )
}
