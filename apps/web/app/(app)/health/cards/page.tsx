import type { HealthCard } from '@ghar/contracts'
import { formatCalendarDate, todayInTimeZone } from '@ghar/core/dates'
import { NotFoundError } from '@ghar/core/errors'
import { hasHealthCardDetails } from '@ghar/core/health'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { HealthCardDetails } from '@/app/(app)/_components/health-card-details'
import { PrintButton } from '@/app/(app)/_components/ui/print-button'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { getPageSession } from '@/lib/api/authed'
import { listPeople } from '@/lib/people/service'
import * as health from '@/lib/health/service'
import { loadTravelMode } from '@/lib/travel/trips'

export const metadata: Metadata = { title: 'Health cards' }

/** Turns a missing person or trip into the 404 page. */
function orNotFound<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound()
    throw error
  })
}

/**
 * Health cards on paper, for a wallet, a bag, or a babysitter's fridge. One person's with
 * `?person=`, a trip's travellers with `?trip=`, or everyone's the caller may see. Plain
 * server-rendered HTML with no links that need a tap, so it prints cleanly.
 */
export default async function HealthCardsPage({ searchParams }: PageProps<'/health/cards'>) {
  const { person, trip: tripId } = await searchParams
  const session = await getPageSession()
  const today = todayInTimeZone(session.household.timeZone)

  let cards: HealthCard[]
  let title = 'Health cards'
  let back = { href: '/health', label: 'Health' }
  if (typeof person === 'string') {
    const card = await orNotFound(health.getHealthCard(session, person))
    cards = [card]
    back = { href: `/health?person=${card.personId}`, label: 'Health' }
  } else if (typeof tripId === 'string') {
    const mode = await orNotFound(loadTravelMode(session, tripId))
    cards = mode.healthCards
    title = `Health cards for ${mode.trip.name}`
    back = { href: `/travel/${mode.trip.id}/mode`, label: 'Travel mode' }
  } else {
    cards = (await health.listHealthCards(session)).filter(hasHealthCardDetails)
  }
  const filled = cards.filter(hasHealthCardDetails)
  // On paper it's handed to someone else, so "You" becomes the name it stands for.
  const people = await listPeople(session.context)
  const nameOf = (card: HealthCard) => people.find(someone => someone.id === card.personId)?.name ?? card.personName
  if (typeof person === 'string' && filled[0] !== undefined) title = `${nameOf(filled[0])}’s health card`

  return (
    <div className='flex flex-col gap-6 print:gap-4 print:text-sm'>
      <header className='flex flex-col gap-3'>
        <Link
          href={back.href}
          className='inline-flex min-h-tap items-center self-start text-sm text-ink-muted underline underline-offset-4 print:hidden'
        >
          {back.label}
        </Link>
        <div className='flex flex-wrap items-end justify-between gap-3'>
          <div>
            <h1 className='text-2xl font-semibold'>{title}</h1>
            <p className='mt-1 text-sm text-ink-muted'>As of {formatCalendarDate(today)}</p>
          </div>
          {filled.length > 0 ? (
            <div className='print:hidden'>
              <PrintButton />
            </div>
          ) : null}
        </div>
      </header>

      {filled.length === 0 ? (
        <EmptyState
          title='Nothing on the card yet'
          action={
            <Button asChild variant='outline'>
              <Link href={back.href}>{back.href.startsWith('/travel') ? 'Back to travel mode' : 'Open health'}</Link>
            </Button>
          }
        >
          Add allergies, blood type or a doctor on the health page, and the card is ready to print.
        </EmptyState>
      ) : (
        filled.map(card => (
          <section
            key={card.personId}
            aria-label={nameOf(card)}
            className='flex break-inside-avoid flex-col gap-3 rounded-card border border-line bg-surface p-4'
          >
            {cards.length > 1 || typeof person !== 'string' ? <h2 className='text-lg font-semibold'>{nameOf(card)}</h2> : null}
            <HealthCardDetails card={card} links={false} />
          </section>
        ))
      )}
    </div>
  )
}
