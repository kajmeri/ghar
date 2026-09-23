import type { Expiry } from '@ghar/contracts'
import { formatCalendarDate, type CalendarDate } from '@ghar/core/dates'
import { DataList } from '@/app/(app)/_components/ui/data-list'
import { Pill } from '@/components/ui/pill'
import { DOCUMENT_KIND_LABELS } from '@/lib/documents/display'
import { expiryHref, expiryLabel, expiryStatus, RENEWAL_KIND_LABELS } from '@/lib/renewals/display'

function source(expiry: Expiry): string {
  switch (expiry.kind) {
    case 'document':
      return DOCUMENT_KIND_LABELS[expiry.documentKind]
    case 'warranty':
      return 'Warranty'
    case 'renewal':
      return RENEWAL_KIND_LABELS[expiry.renewalKind]
  }
}

/** Documents, warranties and renewals together, each with how long it has left. */
export function ExpiryList({ label, expiries, today }: { label: string; expiries: Expiry[]; today: CalendarDate }) {
  return (
    <DataList
      label={label}
      rows={expiries}
      rowKey={expiryHref}
      href={expiryHref}
      primary={{ header: 'Name', cell: expiryLabel }}
      secondary={expiry => `${source(expiry)} · ${formatCalendarDate(expiry.expiresOn)}`}
      columns={[]}
      trailing={{
        header: 'When',
        cell: expiry => {
          const status = expiryStatus(expiry, today)
          return <Pill tone={status.tone}>{status.phrase}</Pill>
        },
      }}
    />
  )
}
