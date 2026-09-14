import type { MaintenanceLogEntry } from '@ghar/contracts'
import { formatCalendarDate } from '@ghar/core/dates'
import { formatCents } from '@ghar/core/money'
import Link from 'next/link'
import { RemoveEntryButton } from './remove-entry-button'

/** Every time a job was done, newest first. */
export function HistoryList({
  label,
  entries,
  currency,
  memberNames,
  canManage,
  showTask,
}: {
  label: string
  entries: readonly MaintenanceLogEntry[]
  currency: string
  memberNames: ReadonlyMap<string, string>
  canManage: boolean
  /** On an asset's page, where entries from different jobs mix. */
  showTask: boolean
}) {
  return (
    <ul aria-label={label} className='divide-y divide-line rounded-card border border-line bg-surface'>
      {entries.map(entry => {
        const date = formatCalendarDate(entry.completedOn)
        const meta = [
          showTask ? date : null,
          entry.completedBy ? memberNames.get(entry.completedBy) : null,
          entry.costCents === null ? null : formatCents(entry.costCents, { currency }),
        ].filter(Boolean)
        return (
          <li key={entry.id} className='flex items-start justify-between gap-4 px-4 py-3'>
            <div className='min-w-0'>
              <p className='font-medium break-words'>{showTask ? entry.taskTitle : date}</p>
              {meta.length > 0 ? <p className='text-sm text-ink-muted tabular-nums'>{meta.join(' · ')}</p> : null}
              {entry.notes ? <p className='mt-1 text-sm break-words whitespace-pre-line'>{entry.notes}</p> : null}
              {entry.documentId ? (
                <Link
                  href={`/documents/${entry.documentId}`}
                  className='inline-flex min-h-tap items-center text-sm underline underline-offset-4 hover:text-ink-muted'
                >
                  Receipt
                </Link>
              ) : null}
            </div>
            {canManage ? <RemoveEntryButton taskId={entry.maintenanceId} entryId={entry.id} when={date} /> : null}
          </li>
        )
      })}
    </ul>
  )
}
