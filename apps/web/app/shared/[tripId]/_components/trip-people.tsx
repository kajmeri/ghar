import type { TripPerson } from '@ghar/contracts'

/** Everyone coming, hosts first, then yes, then maybe. First names only. */
export function TripPeople({ people, householdName }: { people: TripPerson[]; householdName: string }) {
  const going = people.filter(person => person.response === 'going').reduce((sum, person) => sum + person.partySize, 0)
  const maybe = people.filter(person => person.response === 'maybe').reduce((sum, person) => sum + person.partySize, 0)

  return (
    <section aria-labelledby='people-heading' className='flex flex-col gap-3 rounded-card border border-line bg-surface p-4'>
      <div className='flex items-baseline justify-between gap-3'>
        <h2 id='people-heading' className='text-lg font-semibold'>
          Who’s going
        </h2>
        <p className='text-sm text-ink-muted tabular-nums'>
          {going} going{maybe > 0 ? ` · ${String(maybe)} maybe` : ''}
        </p>
      </div>
      {people.length === 0 ? (
        <p className='text-base text-ink-muted'>Nobody has said yes yet. Your answer below puts you on the list.</p>
      ) : (
        <ul className='flex flex-col divide-y divide-line'>
          {people.map((person, index) => (
            <li key={index} className='flex min-h-tap items-center justify-between gap-3 py-2'>
              <span className='min-w-0 truncate text-base'>
                {person.name ?? 'A guest'}
                {person.you ? <span className='text-ink-muted'> (you)</span> : null}
                {person.partySize > 1 ? <span className='text-ink-muted tabular-nums'> +{person.partySize - 1}</span> : null}
              </span>
              <span className='shrink-0 text-sm text-ink-muted'>
                {person.host ? householdName : person.response === 'maybe' ? 'Maybe' : 'Going'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
