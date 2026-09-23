import { can } from '@ghar/core/auth'
import { todayInTimeZone } from '@ghar/core/dates'
import type { Metadata } from 'next'
import { getPageSession } from '@/lib/api/authed'
import * as contacts from '@/lib/contacts/service'
import * as home from '@/lib/home/service'
import { memberName } from '@/lib/households/names'
import * as households from '@/lib/households/service'
import { EmptyState } from '../_components/ui/empty-state'
import { HouseIllustration } from '../_components/ui/illustrations'
import { PageHeader } from '../_components/ui/page-header'
import { SectionHeader } from '../_components/ui/section-header'
import { AssetList } from './_components/asset-list'
import { AssetSheet } from './_components/asset-sheet'
import { JobList } from './_components/job-list'
import { MaintenanceSheet } from './_components/maintenance-sheet'

export const metadata: Metadata = { title: 'House' }

const EMPTY_CARD = 'rounded-card border border-line bg-surface p-4 text-ink-muted'

export default async function HousePage({ searchParams }: PageProps<'/home'>) {
  const [session, { q }] = await Promise.all([getPageSession(), searchParams])
  const { context: ctx, household } = session
  const canManage = can(ctx.role, 'home.manage')

  const [{ assets, tasks }, members, contactList] = await Promise.all([
    home.getHouseOverview(session),
    canManage ? households.listMembers(ctx) : [],
    canManage ? contacts.listContacts(session) : [],
  ])
  const today = todayInTimeZone(household.timeZone)

  const addThing = <AssetSheet currency={household.currency} />
  const addJob = (
    <MaintenanceSheet
      variant='outline'
      assets={assets.map(asset => ({ id: asset.id, name: asset.name }))}
      members={members.map(member => ({ userId: member.userId, name: memberName(member) }))}
      contacts={contactList.map(contact => ({ id: contact.id, name: contact.name, role: contact.role }))}
    />
  )

  if (assets.length === 0 && tasks.length === 0) {
    return (
      <>
        <PageHeader title='House' description='The things you own and the jobs that keep them working' />
        {canManage ? (
          <EmptyState
            illustration={<HouseIllustration />}
            title='Start with the things that break'
            description='Add the dishwasher, the furnace or the car with its model and serial number, so the answer is here when something stops working.'
            action={addThing}
            hint='Jobs like filter changes can be added once there’s something to look after.'
          />
        ) : (
          <EmptyState
            illustration={<HouseIllustration />}
            title='Nothing to look after yet'
            description='Ask an adult in your household to add the appliances and jobs you share, and their due dates show up here.'
          />
        )}
      </>
    )
  }

  return (
    <>
      <PageHeader
        title='House'
        description='The things you own and the jobs that keep them working'
        action={
          canManage ? (
            <>
              {addJob}
              {addThing}
            </>
          ) : undefined
        }
      />
      <div className='flex flex-col gap-8'>
        <section aria-labelledby='things-heading'>
          <SectionHeader id='things-heading' title='Things' />
          {assets.length > 0 ? (
            <AssetList assets={assets} query={typeof q === 'string' ? q : ''} today={today} />
          ) : (
            <p className={EMPTY_CARD}>
              Add the things these jobs are for, with their model and serial numbers, so they’re here when something breaks.
            </p>
          )}
        </section>

        <section aria-labelledby='jobs-heading'>
          <SectionHeader id='jobs-heading' title='Jobs' description='Soonest due first' />
          {tasks.length > 0 ? (
            <JobList label='Jobs' tasks={tasks} today={today} canManage={canManage} />
          ) : (
            <p className={EMPTY_CARD}>
              No jobs yet. Add one like “Replace the furnace filter every 3 months” and Ghar works out when it’s next due.
            </p>
          )}
        </section>
      </div>
    </>
  )
}
