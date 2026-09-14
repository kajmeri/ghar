'use client'

import type { Contact } from '@ghar/contracts'
import { phoneHref, searchContacts } from '@ghar/core/contacts'
import { Phone } from 'lucide-react'
import { useState } from 'react'
import { Avatar } from '@/app/(app)/_components/ui/avatar'
import { DataList } from '@/app/(app)/_components/ui/data-list'
import { SearchField } from '@/app/(app)/_components/ui/search-field'
import { Button } from '@/components/ui/button'

/** Everyone the household calls, searchable by name, role or tag, with Call right on the row. */
export function ContactList({ contacts }: { contacts: Contact[] }) {
  const [query, setQuery] = useState('')
  const shown = query.trim() === '' ? contacts : searchContacts(contacts, query)

  return (
    <div className='flex flex-col gap-3'>
      <SearchField label='Search contacts' value={query} onChange={setQuery} placeholder='Name, or what they do, like plumber' />
      <DataList
        label='Contacts'
        rows={shown}
        rowKey={contact => contact.id}
        href={contact => `/contacts/${contact.id}`}
        leading={contact => <Avatar name={contact.name} />}
        primary={{ header: 'Name', cell: contact => contact.name }}
        secondary={contact => [contact.role, ...contact.tags].filter(Boolean).join(' · ')}
        columns={[
          {
            id: 'phone',
            header: 'Phone',
            stacked: false,
            cell: contact =>
              contact.phone ? <span className='tabular-nums'>{contact.phone}</span> : <span className='text-ink-muted'>None</span>,
          },
          {
            id: 'email',
            header: 'Email',
            showFrom: 'lg',
            stacked: false,
            cell: contact =>
              contact.email ? <span className='break-all'>{contact.email}</span> : <span className='text-ink-muted'>None</span>,
          },
        ]}
        trailing={{
          header: 'Call',
          cell: contact => {
            const href = contact.phone ? phoneHref(contact.phone) : null
            if (!href) return null
            return (
              <Button asChild variant='outline' size='icon' className='relative z-10'>
                <a href={href} aria-label={`Call ${contact.name}`}>
                  <Phone aria-hidden />
                </a>
              </Button>
            )
          },
        }}
        empty={
          <p className='rounded-card border border-line bg-surface p-4 text-ink-muted'>
            No one matches “{query.trim()}”. Try a name, or what they do.
          </p>
        }
      />
    </div>
  )
}
