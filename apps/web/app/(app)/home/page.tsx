import { can } from '@ghar/core/auth'
import type { Metadata } from 'next'
import { Button } from '@/components/ui/button'
import { getPageContext } from '@/lib/auth/context'
import { EmptyState } from '../_components/ui/empty-state'
import { HouseIllustration } from '../_components/ui/illustrations'
import { PageHeader } from '../_components/ui/page-header'

export const metadata: Metadata = { title: 'House' }

export default async function HousePage() {
  const { ctx } = await getPageContext()

  return (
    <>
      <PageHeader title='House' description='Maintenance and assets' />
      {can(ctx.role, 'home.manage') ? (
        <EmptyState
          illustration={<HouseIllustration />}
          title='Start a list of what needs looking after'
          description='Add appliances and recurring jobs like filter changes and Ghar tells you when each one is due.'
          action={<Button disabled>Add an item</Button>}
          hint='Maintenance tracking arrives in a later update.'
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
