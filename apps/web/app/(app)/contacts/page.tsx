import { can } from '@ghar/core/auth'
import type { Metadata } from 'next'
import { getPageSession } from '@/lib/api/authed'
import * as contacts from '@/lib/contacts/service'
import { EmptyState } from '../_components/ui/empty-state'
import { PeopleIllustration } from '../_components/ui/illustrations'
import { PageHeader } from '../_components/ui/page-header'
import { ContactList } from './_components/contact-list'
import { ContactSheet } from './_components/contact-sheet'

export const metadata: Metadata = { title: 'Contacts' }

export default async function ContactsPage() {
  const session = await getPageSession()
  const canManage = can(session.context.role, 'contacts.manage')
  const list = await contacts.listContacts(session)

  const header = (
    <PageHeader
      title='Contacts'
      description='The plumber, the pediatrician, the insurance agent'
      action={canManage && list.length > 0 ? <ContactSheet /> : undefined}
    />
  )

  if (list.length === 0) {
    return (
      <>
        {header}
        {canManage ? (
          <EmptyState
            illustration={<PeopleIllustration />}
            title='Keep the people you call in one place'
            description='Add the plumber, the pediatrician or the insurance agent with their number, then pick them on the jobs they do.'
            action={<ContactSheet />}
          />
        ) : (
          <EmptyState
            illustration={<PeopleIllustration />}
            title='No contacts yet'
            description='Ask an adult in your household to add the people you call, and their numbers show up here.'
          />
        )}
      </>
    )
  }

  return (
    <>
      {header}
      <ContactList contacts={list} />
    </>
  )
}
