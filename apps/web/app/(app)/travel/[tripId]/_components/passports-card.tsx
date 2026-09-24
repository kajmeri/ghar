import type { Person, TripDocumentIssueValue } from '@ghar/contracts'
import type { CalendarDate } from '@ghar/core/dates'
import { comparePeople, personLabel, tripDocumentIssuePhrase, tripDocumentIssueTone } from '@ghar/core/people'
import { CircleCheck, OctagonAlert, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * For a trip abroad: whose passport won't do, and why. Only shown to someone who can see
 * passports; anyone else would be told a traveller has none when they do.
 */
export function PassportsCard({
  issues,
  people,
  travellerIds,
  currentUserId,
  today,
  canEdit,
}: {
  issues: TripDocumentIssueValue[]
  people: Person[]
  travellerIds: string[]
  currentUserId: string
  today: CalendarDate
  canEdit: boolean
}) {
  const byId = new Map(people.map(person => [person.id, person]))
  const nameOf = (personId: string) => {
    const person = byId.get(personId)
    return person ? personLabel(person, currentUserId) : 'Someone'
  }
  const order = [...people].sort(comparePeople(currentUserId)).map(person => person.id)
  const sorted = [...issues].sort((a, b) => order.indexOf(a.personId) - order.indexOf(b.personId))

  return (
    <section aria-labelledby='passports-heading' className='rounded-card border border-line bg-surface p-4'>
      <h2 id='passports-heading' className='font-semibold'>
        Passports
      </h2>

      {travellerIds.length === 0 ? (
        <p className='mt-1 text-ink-muted'>
          {canEdit ? 'Pick who’s going under Edit trip, and Ghar checks their passports.' : 'Nobody is on this trip yet.'}
        </p>
      ) : sorted.length === 0 ? (
        <p className='mt-2 flex items-start gap-2'>
          <CircleCheck aria-hidden className='mt-0.5 size-5 shrink-0 text-positive' />
          Everyone’s passport lasts at least 6 months past the trip.
        </p>
      ) : (
        <ul className='mt-2 flex flex-col divide-y divide-line'>
          {sorted.map(issue => {
            const tone = tripDocumentIssueTone(issue.kind)
            const Icon = tone === 'negative' ? OctagonAlert : TriangleAlert
            return (
              <li key={issue.personId} className='flex min-h-tap items-start gap-3 py-2.5'>
                <Icon aria-hidden className={cn('mt-0.5 size-5 shrink-0', tone === 'negative' ? 'text-negative' : 'text-caution-ink')} />
                <div className='min-w-0 flex-1'>
                  <p className='font-medium break-words'>{nameOf(issue.personId)}</p>
                  <p className='text-sm text-ink-muted'>{tripDocumentIssuePhrase(issue, today)}</p>
                </div>
                {issue.documentId ? (
                  <Link
                    href={`/documents/${issue.documentId}`}
                    className='flex min-h-tap shrink-0 items-center text-sm underline underline-offset-4 hover:text-ink-muted'
                  >
                    Open<span className='sr-only'> {nameOf(issue.personId)}’s passport</span>
                  </Link>
                ) : (
                  <Link
                    href='/documents'
                    className='flex min-h-tap shrink-0 items-center text-sm underline underline-offset-4 hover:text-ink-muted'
                  >
                    Add it<span className='sr-only'> to documents</span>
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
