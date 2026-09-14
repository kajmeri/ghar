'use client'

import type { HouseholdDocument } from '@ghar/contracts'
import { formatCalendarDate, type CalendarDate } from '@ghar/core/dates'
import { expiryPhrase, searchDocuments } from '@ghar/core/documents'
import { FileText, Lock } from 'lucide-react'
import { useState } from 'react'
import { IconAvatar } from '@/app/(app)/_components/ui/avatar'
import { DataList } from '@/app/(app)/_components/ui/data-list'
import { SearchField } from '@/app/(app)/_components/ui/search-field'
import { Pill } from '@/components/ui/pill'
import { DOCUMENT_KIND_LABELS, EXPIRY_TONES } from '@/lib/documents/display'

/** Every document, filtered as someone types. The whole list is already here, so there's no round trip. */
export function DocumentList({ documents, today }: { documents: HouseholdDocument[]; today: CalendarDate }) {
  const [query, setQuery] = useState('')
  const shown = query.trim() === '' ? documents : searchDocuments(documents, query)

  return (
    <div className='flex flex-col gap-3'>
      <SearchField label='Search documents' value={query} onChange={setQuery} placeholder='Title, policy number or issuer' />
      <DataList
        label='Documents'
        rows={shown}
        rowKey={document => document.id}
        href={document => `/documents/${document.id}`}
        leading={document => <IconAvatar icon={document.isSensitive ? Lock : FileText} />}
        primary={{ header: 'Document', cell: document => document.title }}
        secondary={document =>
          [document.isSensitive ? 'Private' : null, DOCUMENT_KIND_LABELS[document.kind], document.referenceNumber, document.assetName]
            .filter(Boolean)
            .join(' · ')
        }
        columns={[
          {
            id: 'expires',
            header: 'Expires',
            showFrom: 'lg',
            stacked: false,
            cell: document =>
              document.expiresOn ? formatCalendarDate(document.expiresOn) : <span className='text-ink-muted'>Never</span>,
          },
        ]}
        trailing={{
          header: 'Expiry',
          cell: document =>
            document.expiresOn && document.expiryState && document.expiryState !== 'current' ? (
              <Pill tone={EXPIRY_TONES[document.expiryState]}>{expiryPhrase(document.expiresOn, today)}</Pill>
            ) : null,
        }}
        empty={
          <p className='rounded-card border border-line bg-surface px-4 py-6 text-center text-ink-muted'>
            Nothing matches “{query.trim()}”. Try a word from the title, the issuer or a reference number.
          </p>
        }
      />
    </div>
  )
}
