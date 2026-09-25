'use client'

import type { HealthEvent } from '@ghar/contracts'
import { formatCalendarDate, type CalendarDate } from '@ghar/core/dates'
import { groupHealthEventsByYear, HEALTH_KIND_LABELS } from '@ghar/core/health'
import { useState } from 'react'
import { DataList } from '@/app/(app)/_components/ui/data-list'
import { SectionHeader } from '@/app/(app)/_components/ui/section-header'
import type { HealthFormOptions } from '@/lib/health/service'
import { HealthEventSheet } from './health-event-sheet'

/** The kind, unless the title already says it, and who it was with. */
function detailLine(event: HealthEvent): string {
  const kind = HEALTH_KIND_LABELS[event.kind]
  return [event.title === kind ? null : kind, event.contactName].filter(Boolean).join(' · ')
}

/**
 * One person's records, by year, newest first. A record the caller may change opens in a sheet;
 * the rest just read.
 */
export function HealthTimeline({
  events,
  personId,
  personName,
  options,
  today,
}: {
  events: HealthEvent[]
  personId: string
  personName: string
  /** Null when the caller can't log for this person. */
  options: HealthFormOptions | null
  today: CalendarDate
}) {
  // `turn` mounts a fresh sheet on each open, and the id is kept while the sheet slides away.
  const [open, setOpen] = useState<{ id: string; turn: number; visible: boolean } | null>(null)
  const opened = open === null ? null : (events.find(event => event.id === open.id) ?? null)

  return (
    <div className='flex flex-col gap-8'>
      {groupHealthEventsByYear(events).map(({ year, events: rows }) => (
        <section key={year} aria-labelledby={`health-${year}`}>
          <SectionHeader id={`health-${year}`} title={year} />
          <DataList
            label={`Records from ${year}`}
            rows={rows}
            rowKey={event => event.id}
            onSelect={
              options === null
                ? undefined
                : event => {
                    if (!event.canEdit) return
                    setOpen(current => ({ id: event.id, turn: (current?.turn ?? 0) + 1, visible: true }))
                  }
            }
            selectPopup={options === null ? undefined : 'dialog'}
            primary={{ header: 'Record', cell: event => event.title }}
            secondary={event => (
              <span className='flex flex-col gap-0.5'>
                {detailLine(event) ? <span>{detailLine(event)}</span> : null}
                {event.note ? <span className='line-clamp-2'>{event.note}</span> : null}
                {event.documentTitle ? <span>Paperwork: {event.documentTitle}</span> : null}
              </span>
            )}
            trailing={{
              header: 'When',
              cell: event => <span className='tabular-nums'>{formatCalendarDate(event.occurredOn, 'MMM d')}</span>,
            }}
          />
        </section>
      ))}

      {open === null || opened === null || options === null ? null : (
        <HealthEventSheet
          key={open.turn}
          personId={personId}
          personName={personName}
          event={opened}
          options={options}
          today={today}
          open={open.visible}
          onClose={() => {
            setOpen(current => (current === null ? null : { ...current, visible: false }))
          }}
        />
      )}
    </div>
  )
}
