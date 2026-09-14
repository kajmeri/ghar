import { can } from '@ghar/core/auth'
import { todayInTimeZone } from '@ghar/core/dates'
import type { Metadata } from 'next'
import { getPageSession } from '@/lib/api/authed'
import * as documents from '@/lib/documents/service'
import * as home from '@/lib/home/service'
import { EmptyState } from '../_components/ui/empty-state'
import { DocumentIllustration } from '../_components/ui/illustrations'
import { PageHeader } from '../_components/ui/page-header'
import { DocumentList } from './_components/document-list'
import { DocumentSheet } from './_components/document-sheet'

export const metadata: Metadata = { title: 'Documents' }

export default async function DocumentsPage() {
  const session = await getPageSession()
  const { role } = session.context
  const canManage = can(role, 'documents.manage')
  const [list, assets] = await Promise.all([documents.listDocuments(session), canManage ? home.listAssets(session) : []])

  const addButton = canManage ? (
    <DocumentSheet
      assets={assets.map(asset => ({ id: asset.id, name: asset.name }))}
      canMarkSensitive={can(role, 'documents.viewSensitive')}
    />
  ) : undefined

  return (
    <>
      <PageHeader
        title='Documents'
        description='Passports, policies, registrations and warranties'
        action={list.length > 0 ? addButton : undefined}
      />
      {list.length > 0 ? (
        <DocumentList documents={list} today={todayInTimeZone(session.household.timeZone)} />
      ) : addButton ? (
        <EmptyState
          illustration={<DocumentIllustration />}
          title='Keep important papers where you can find them'
          description='Take a photo of a passport, policy or warranty and add its expiry date. Ghar emails a reminder 60, 30 and 7 days before.'
          action={addButton}
        />
      ) : (
        <EmptyState
          illustration={<DocumentIllustration />}
          title='No documents yet'
          description='Ask an adult in your household to add the papers you need, and they show up here.'
        />
      )}
    </>
  )
}
