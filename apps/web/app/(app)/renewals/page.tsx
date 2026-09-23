import type { Expiry } from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import { addCalendarDays, todayInTimeZone } from '@ghar/core/dates'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { getPageSession } from '@/lib/api/authed'
import * as renewals from '@/lib/renewals/service'
import { EmptyState } from '../_components/ui/empty-state'
import { ChecklistIllustration } from '../_components/ui/illustrations'
import { PageHeader } from '../_components/ui/page-header'
import { SectionHeader } from '../_components/ui/section-header'
import { ExpiryList } from './_components/expiry-list'
import { RenewalSheet } from './_components/renewal-sheet'

export const metadata: Metadata = { title: 'Renewals' }

/** How far back expired things show before someone asks for older ones. */
const EXPIRED_LOOKBACK_DAYS = 365

export default async function RenewalsPage({ searchParams }: PageProps<'/renewals'>) {
  const { older } = await searchParams
  const showOlder = older === '1'
  const session = await getPageSession()
  const today = todayInTimeZone(session.household.timeZone)
  const canManage = can(session.context.role, 'documents.manage')

  const [expiries, options] = await Promise.all([
    renewals.listAllExpiries(session, showOlder ? undefined : addCalendarDays(today, -EXPIRED_LOOKBACK_DAYS)),
    canManage ? renewals.listRenewalFormOptions(session) : null,
  ])
  const addButton = options ? <RenewalSheet options={options} currency={session.household.currency} /> : undefined

  const live = expiries.filter(expiry => !expiry.notRenewing)
  const groups: { id: string; title: string; description?: string; rows: Expiry[] }[] = [
    {
      id: 'expired',
      title: 'Expired',
      description: showOlder ? undefined : 'In the past year',
      rows: live.filter(expiry => expiry.state === 'expired').toReversed(),
    },
    { id: 'soon', title: 'Coming up', description: 'Close enough that reminders have started', rows: live.filter(expiry => expiry.state === 'expiring') },
    { id: 'later', title: 'Later', rows: live.filter(expiry => expiry.state === 'current') },
    {
      id: 'not-renewing',
      title: 'Not renewing',
      description: 'No reminders for these. A new date brings one back.',
      rows: expiries.filter(expiry => expiry.notRenewing),
    },
  ].filter(group => group.rows.length > 0)

  return (
    <>
      <PageHeader
        title='Renewals'
        description='Papers, warranties and anything else with a date it runs out'
        action={expiries.length > 0 ? addButton : undefined}
      />
      {expiries.length > 0 ? (
        <div className='flex flex-col gap-8'>
          {groups.map(group => (
            <section key={group.id} aria-labelledby={`${group.id}-heading`}>
              <SectionHeader id={`${group.id}-heading`} title={group.title} description={group.description} />
              <ExpiryList label={group.title} expiries={group.rows} today={today} />
            </section>
          ))}
          {showOlder ? null : (
            <div>
              <Button asChild variant='ghost'>
                <Link href='/renewals?older=1'>Show older ones</Link>
              </Button>
            </div>
          )}
        </div>
      ) : canManage ? (
        <EmptyState
          illustration={<ChecklistIllustration />}
          title='Never get caught by a lapsed registration'
          description='Add the car registration, the driver’s licenses and the memberships your household renews. Ghar emails reminders as each one gets close, months ahead for a passport. Documents with an expiry date and warranties show up here too.'
          action={addButton}
        />
      ) : (
        <EmptyState
          illustration={<ChecklistIllustration />}
          title='Nothing running out'
          description='When an owner or adult adds a registration, a membership or a document with an expiry date, it shows up here.'
        />
      )}
    </>
  )
}
