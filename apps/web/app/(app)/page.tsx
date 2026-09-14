import { can } from '@ghar/core/auth'
import { formatInstant } from '@ghar/core/dates'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { getPageContext } from '@/lib/auth/context'
import * as households from '@/lib/households/service'
import { EmptyState } from './_components/ui/empty-state'
import { ChecklistIllustration, PeopleIllustration } from './_components/ui/illustrations'
import { PageHeader } from './_components/ui/page-header'

export const metadata: Metadata = { title: 'Home' }

export default async function HomePage() {
  const { ctx, session } = await getPageContext()
  const [{ household }, members] = await Promise.all([households.getMyHousehold(ctx, session), households.listMembers(ctx)])
  const inviteFirst = can(ctx.role, 'members.invite') && members.length < 2

  return (
    <>
      <PageHeader title={household.name} description={today(household.timezone)} />
      {inviteFirst ? (
        <EmptyState
          illustration={<PeopleIllustration />}
          title='Ghar works best shared'
          description='Invite the people you live with so everyone sees the same bills, plans and reminders.'
          action={
            <Button asChild>
              <Link href='/settings/household'>Invite someone</Link>
            </Button>
          }
        />
      ) : (
        <EmptyState
          illustration={<ChecklistIllustration />}
          title='Nothing needs you today'
          description='Bills, trips and house jobs land here when they need attention, so for now make sure everyone you live with has joined.'
          action={
            <Button asChild variant='outline'>
              <Link href='/settings/household'>View household</Link>
            </Button>
          }
        />
      )}
    </>
  )
}

function today(timeZone: string): string {
  return formatInstant(new Date(), timeZone, { dateStyle: 'full' })
}
