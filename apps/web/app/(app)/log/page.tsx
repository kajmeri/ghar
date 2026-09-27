import type { Metadata } from 'next'
import { getPageSession } from '@/lib/api/authed'
import { quickLogSetup } from '@/lib/quick-log/service'
import { QuickLog } from '../_components/quick-log'
import { EmptyState } from '../_components/ui/empty-state'
import { ChecklistIllustration } from '../_components/ui/illustrations'
import { PageHeader } from '../_components/ui/page-header'

export const metadata: Metadata = { title: 'Log something' }

/** The quick log on its own page, reached from More on a phone. */
export default async function LogPage() {
  const setup = await quickLogSetup(await getPageSession())
  return (
    <>
      <PageHeader title='Log something' description='Say what happened in a sentence. You check it before anything is saved.' />
      {setup === null ? (
        <EmptyState
          illustration={<ChecklistIllustration />}
          title='There’s nothing here for you to log'
          description='Your role in this household can see things but not change them. An owner can change your role in Settings.'
        />
      ) : (
        <QuickLog {...setup} label='What happened?' />
      )}
    </>
  )
}
