import type { MaintenanceTask } from '@ghar/contracts'
import type { CalendarDate } from '@ghar/core/dates'
import Link from 'next/link'
import { ROW_LINK } from '@/app/(app)/_components/ui/row-link'
import { Pill } from '@/components/ui/pill'
import { dueText, MAINTENANCE_TONES } from '@/lib/home/display'
import { MarkDoneButton } from './mark-done-button'

/** Jobs, each a link to its page, with Mark done right on the row. */
export function JobList({
  label,
  tasks,
  today,
  canManage,
  showAsset = true,
}: {
  label: string
  tasks: readonly MaintenanceTask[]
  today: CalendarDate
  canManage: boolean
  /** Off on an asset's own page, where every job is for it. */
  showAsset?: boolean
}) {
  return (
    <ul aria-label={label} className='divide-y divide-line overflow-hidden rounded-card border border-line bg-surface'>
      {tasks.map(task => {
        const urgent = task.state === 'overdue' || task.state === 'due_soon'
        const meta = [
          showAsset ? task.assetName : null,
          task.cadence ?? 'Once',
          urgent ? null : dueText(task.nextDueOn, today),
        ].filter(Boolean)
        return (
          <li key={task.id} className='relative flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-paper'>
            <div className='min-w-0'>
              <p className='font-medium break-words'>
                <Link href={`/home/maintenance/${task.id}`} className={ROW_LINK}>
                  {task.title}
                </Link>
              </p>
              <p className='text-sm break-words text-ink-muted'>{meta.join(' · ')}</p>
              {urgent ? (
                <p className='mt-1'>
                  <Pill tone={MAINTENANCE_TONES[task.state]}>{dueText(task.nextDueOn, today)}</Pill>
                </p>
              ) : null}
            </div>
            {canManage ? <MarkDoneButton taskId={task.id} title={task.title} className='relative z-10 shrink-0' /> : null}
          </li>
        )
      })}
    </ul>
  )
}
