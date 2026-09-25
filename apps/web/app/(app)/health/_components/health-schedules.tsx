'use client'

import type { HealthSchedule } from '@ghar/contracts'
import { formatCalendarDate, type CalendarDate } from '@ghar/core/dates'
import { renewalCadenceLabel } from '@ghar/core/renewals'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { DataList } from '@/app/(app)/_components/ui/data-list'
import { SectionHeader } from '@/app/(app)/_components/ui/section-header'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/pill'
import { healthDueStatus } from '@/lib/health/display'
import type { HealthFormOptions } from '@/lib/health/service'
import { HealthEventSheet } from './health-event-sheet'
import { HealthScheduleSheet } from './health-schedule-sheet'

type Opened = { scheduleId: string; sheet: 'edit' | 'log'; turn: number; visible: boolean }

/**
 * What's due next for one person: each schedule with its date and how close it is. A schedule the
 * caller may change opens to edit, and "Log it" records the visit, which moves it on.
 */
export function HealthSchedules({
  schedules,
  personId,
  personName,
  options,
  today,
}: {
  schedules: HealthSchedule[]
  personId: string
  personName: string
  /** Null when the caller can't log for this person. */
  options: HealthFormOptions | null
  today: CalendarDate
}) {
  // `turn` mounts a fresh sheet on each open, and the id is kept while the sheet slides away.
  const [open, setOpen] = useState<Opened | null>(null)
  const opened = open === null ? null : (schedules.find(schedule => schedule.id === open.scheduleId) ?? null)
  const show = (scheduleId: string, sheet: Opened['sheet']) => {
    setOpen(current => ({ scheduleId, sheet, turn: (current?.turn ?? 0) + 1, visible: true }))
  }
  const hide = () => {
    setOpen(current => (current === null ? null : { ...current, visible: false }))
  }
  const whose = personName === 'You' ? 'your' : `${personName}’s`

  if (schedules.length === 0 && options === null) return null

  const addButton =
    options === null ? undefined : (
      <HealthScheduleSheet
        personId={personId}
        personName={personName}
        today={today}
        trigger={
          <Button variant={schedules.length === 0 ? 'outline' : 'ghost'}>
            <Plus aria-hidden />
            Add a schedule
          </Button>
        }
      />
    )

  return (
    <section aria-labelledby='health-due'>
      <SectionHeader
        id='health-due'
        title='Coming up'
        description={schedules.length === 0 ? undefined : 'When each is next due, from the last visit logged'}
        action={schedules.length === 0 ? undefined : addButton}
      />
      {schedules.length === 0 ? (
        <div className='flex flex-col items-start gap-3 rounded-card border border-line bg-surface p-4'>
          <p className='text-ink-muted'>
            Add how often {whose} dentist, checkups and shots come round, and Ghar reminds you before each one is due.
          </p>
          {addButton}
        </div>
      ) : (
        <DataList
          label={`What’s next due for ${personName === 'You' ? 'you' : personName}`}
          rows={schedules}
          rowKey={schedule => schedule.id}
          onSelect={
            options === null
              ? undefined
              : schedule => {
                  if (schedule.canEdit) show(schedule.id, 'edit')
                }
          }
          selectPopup={options === null ? undefined : 'dialog'}
          primary={{ header: 'Schedule', cell: schedule => schedule.name }}
          secondary={schedule => (
            <span className='flex flex-col items-start gap-2'>
              <span>
                {renewalCadenceLabel(schedule.cadenceMonths)} ·{' '}
                {schedule.lastOn === null ? (
                  'nothing logged yet'
                ) : (
                  <>
                    last <span className='tabular-nums'>{formatCalendarDate(schedule.lastOn)}</span>
                  </>
                )}
              </span>
              {options !== null && schedule.canEdit ? (
                <Button
                  type='button'
                  variant='outline'
                  className='relative z-10'
                  onClick={() => {
                    show(schedule.id, 'log')
                  }}
                >
                  Log it
                </Button>
              ) : null}
            </span>
          )}
          trailing={{
            header: 'Due',
            cell: schedule => {
              const status = healthDueStatus(schedule, today)
              return (
                <span className='flex flex-col items-end gap-1'>
                  <Pill tone={status.tone}>{status.phrase}</Pill>
                  <span className='text-sm text-ink-muted tabular-nums'>{formatCalendarDate(schedule.dueOn)}</span>
                </span>
              )
            },
          }}
        />
      )}

      {open === null || opened === null || options === null ? null : open.sheet === 'edit' ? (
        <HealthScheduleSheet
          key={open.turn}
          personId={personId}
          personName={personName}
          schedule={opened}
          today={today}
          open={open.visible}
          onClose={hide}
        />
      ) : (
        <HealthEventSheet
          key={open.turn}
          personId={personId}
          personName={personName}
          preset={{ kind: opened.kind, title: opened.title }}
          options={options}
          today={today}
          open={open.visible}
          onClose={hide}
        />
      )}
    </section>
  )
}
