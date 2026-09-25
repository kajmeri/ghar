import { todayInTimeZone } from '@ghar/core/dates'
import type { Metadata } from 'next'
import { getPageSession } from '@/lib/api/authed'
import * as health from '@/lib/health/service'
import { EmptyState } from '../_components/ui/empty-state'
import { HeartIllustration } from '../_components/ui/illustrations'
import { PageHeader } from '../_components/ui/page-header'
import { HealthCard } from './_components/health-card'
import { AddHealthEventButton } from './_components/health-event-sheet'
import { HealthMedicines } from './_components/health-medicines'
import { HealthSchedules } from './_components/health-schedules'
import { HealthTimeline } from './_components/health-timeline'
import { PersonPicker } from './_components/person-picker'

export const metadata: Metadata = { title: 'Health' }

export default async function HealthPage({ searchParams }: PageProps<'/health'>) {
  const { person: asked } = await searchParams
  const session = await getPageSession()
  const today = todayInTimeZone(session.household.timeZone)

  const people = await health.listHealthPeople(session)
  const person = people.find(candidate => candidate.id === asked) ?? people[0]
  if (!person) {
    return (
      <>
        <PageHeader title='Health' />
        <EmptyState
          illustration={<HeartIllustration />}
          title='Nothing to show you'
          description='Once you’re one of the household’s people, your visits and shots show up here.'
        />
      </>
    )
  }

  const [card, events, schedules, medicines, options] = await Promise.all([
    health.getHealthCard(session, person.id),
    health.listAllHealthEvents(session, person.id),
    health.listHealthSchedules(session, person.id),
    health.listHealthMedicines(session, { personId: person.id }),
    person.canLog ? health.listHealthFormOptions(session) : null,
  ])
  const addButton = options ? (
    <AddHealthEventButton personId={person.id} personName={person.name} options={options} today={today} />
  ) : undefined
  const whose = person.name === 'You' ? 'your' : `${person.name}’s`

  return (
    <>
      <PageHeader
        title='Health'
        description={
          people.length > 1
            ? 'Health cards, visits, shots, checkups and medicines for everyone at home.'
            : 'Your health card, visits, shots, checkups and medicines.'
        }
        action={addButton}
      />
      <div className='flex flex-col gap-6'>
        {people.length > 1 ? <PersonPicker people={people} currentId={person.id} /> : null}
        <HealthCard card={card} options={options} />
        <HealthSchedules schedules={schedules} personId={person.id} personName={person.name} options={options} today={today} />
        <HealthMedicines medicines={medicines} personId={person.id} personName={person.name} options={options} today={today} />
        {events.length === 0 ? (
          <EmptyState
            illustration={<HeartIllustration />}
            title={person.name === 'You' ? 'No records yet' : `No records for ${person.name} yet`}
            description={
              options
                ? `Log a shot, a checkup or a trip to the dentist, and ${whose} history builds up here.`
                : 'When an owner or adult logs a visit or a shot for you, it shows up here.'
            }
            action={addButton}
          />
        ) : (
          <HealthTimeline events={events} personId={person.id} personName={person.name} options={options} today={today} />
        )}
      </div>
    </>
  )
}
