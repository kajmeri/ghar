import type { HealthPerson } from '@ghar/contracts'
import Link from 'next/link'
import { cn } from '@/lib/utils'

/** Whose records to show. Pills that wrap onto new lines rather than scroll sideways. */
export function PersonPicker({ people, currentId }: { people: HealthPerson[]; currentId: string }) {
  return (
    <nav aria-label='Whose records'>
      <ul className='flex flex-wrap gap-2'>
        {people.map(person => {
          const current = person.id === currentId
          return (
            <li key={person.id}>
              <Link
                href={`/health?person=${person.id}`}
                scroll={false}
                replace
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex min-h-tap items-center gap-2 rounded-pill border px-4 text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
                  current ? 'border-ink bg-ink font-medium text-paper' : 'border-line bg-surface text-ink hover:border-ink-muted'
                )}
              >
                {person.name}
                <span className={cn('tabular-nums', current ? 'text-paper/70' : 'text-ink-muted')}>
                  {person.eventCount}
                  <span className='sr-only'> {person.eventCount === 1 ? 'record' : 'records'}</span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
