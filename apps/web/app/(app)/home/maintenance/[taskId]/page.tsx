import { maintenanceParamsSchema } from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import { formatCalendarDate, todayInTimeZone } from '@ghar/core/dates'
import { phoneHref } from '@ghar/core/contacts'
import { NotFoundError } from '@ghar/core/errors'
import { Phone } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/pill'
import { getPageSession } from '@/lib/api/authed'
import { getPageContext } from '@/lib/auth/context'
import * as contacts from '@/lib/contacts/service'
import { dueText, MAINTENANCE_TONES } from '@/lib/home/display'
import * as home from '@/lib/home/service'
import { memberName } from '@/lib/households/names'
import * as households from '@/lib/households/service'
import { Avatar } from '../../../_components/ui/avatar'
import { BackLink } from '../../../_components/ui/back-link'
import { PageHeader } from '../../../_components/ui/page-header'
import { SectionHeader } from '../../../_components/ui/section-header'
import { DeleteTask } from '../../_components/delete-buttons'
import { HistoryList } from '../../_components/history-list'
import { LogCompletionSheet } from '../../_components/log-completion-sheet'
import { MaintenanceSheet } from '../../_components/maintenance-sheet'
import { MarkDoneButton } from '../../_components/mark-done-button'

export const metadata: Metadata = { title: 'Job' }

const CARD = 'rounded-card border border-line bg-surface p-4 md:p-6'
const EMPTY_CARD = 'rounded-card border border-line bg-surface p-4 text-ink-muted'

export default async function MaintenancePage({ params }: PageProps<'/home/maintenance/[taskId]'>) {
  const { taskId } = await params
  if (!maintenanceParamsSchema.safeParse({ taskId }).success) notFound()
  const { ctx, session: sessionContext } = await getPageContext()
  const session = await getPageSession()
  const canManage = can(ctx.role, 'home.manage')

  const [{ task, history }, { household }, members, assets, contactList] = await Promise.all([
    home.getMaintenanceDetail(session, taskId).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound()
      throw error
    }),
    households.getMyHousehold(ctx, sessionContext),
    households.listMembers(ctx),
    canManage ? home.listAssets(session) : [],
    canManage ? contacts.listContacts(session) : [],
  ])
  const today = todayInTimeZone(household.timezone)
  const names = new Map(members.map(member => [member.userId, memberName(member)]))
  const assignee = task.assignedUserId ? names.get(task.assignedUserId) : undefined
  const urgent = task.state === 'overdue' || task.state === 'due_soon'
  const vendorPhone = task.vendor?.phone ? phoneHref(task.vendor.phone) : null

  const rows: { label: string; value: ReactNode }[] = [
    {
      label: 'Next due',
      value: urgent ? (
        <Pill tone={MAINTENANCE_TONES[task.state]}>{dueText(task.nextDueOn, today)}</Pill>
      ) : task.nextDueOn ? (
        formatCalendarDate(task.nextDueOn)
      ) : (
        <span className='text-ink-muted'>Not scheduled</span>
      ),
    },
    urgent && task.nextDueOn ? { label: 'Due date', value: formatCalendarDate(task.nextDueOn) } : null,
    { label: 'Last done', value: task.lastDoneOn ? formatCalendarDate(task.lastDoneOn) : <span className='text-ink-muted'>Not yet</span> },
    { label: 'How often', value: task.cadence ?? 'Once' },
    task.assetId && task.assetName
      ? {
          label: 'For',
          value: (
            <Link href={`/home/assets/${task.assetId}`} className='underline underline-offset-4 hover:text-ink-muted'>
              {task.assetName}
            </Link>
          ),
        }
      : null,
    assignee ? { label: 'Whose job', value: assignee } : null,
  ].filter(row => row !== null)

  return (
    <>
      {task.assetId && task.assetName ? (
        <BackLink href={`/home/assets/${task.assetId}`}>{task.assetName}</BackLink>
      ) : (
        <BackLink href='/home'>House</BackLink>
      )}
      <PageHeader
        title={task.title}
        description={[task.assetName, task.cadence ?? 'Once'].filter(Boolean).join(' · ')}
        action={
          canManage ? (
            <>
              <MarkDoneButton taskId={task.id} title={task.title} variant='default' />
              <LogCompletionSheet taskId={task.id} today={today} currency={household.currency} />
              <MaintenanceSheet
                task={task}
                assets={assets.map(asset => ({ id: asset.id, name: asset.name }))}
                members={members.map(member => ({ userId: member.userId, name: memberName(member) }))}
                contacts={contactList.map(contact => ({ id: contact.id, name: contact.name, role: contact.role }))}
              />
            </>
          ) : undefined
        }
      />

      <div className='flex flex-col gap-8'>
        <dl aria-label='Schedule' className='divide-y divide-line rounded-card border border-line bg-surface'>
          {rows.map(row => (
            <div key={row.label} className='flex items-start justify-between gap-4 px-4 py-3'>
              <dt className='shrink-0 text-ink-muted'>{row.label}</dt>
              <dd className='min-w-0 text-right break-words'>{row.value}</dd>
            </div>
          ))}
        </dl>

        {task.vendor ? (
          <section aria-labelledby='vendor-heading'>
            <SectionHeader id='vendor-heading' title='Who to call' />
            <div className={`${CARD} flex flex-wrap items-center justify-between gap-4`}>
              <div className='flex min-w-0 items-center gap-3'>
                <Avatar name={task.vendor.name} />
                <div className='min-w-0'>
                  <p className='font-medium break-words'>
                    <Link href={`/contacts/${task.vendor.id}`} className='underline-offset-4 hover:underline'>
                      {task.vendor.name}
                    </Link>
                  </p>
                  {task.vendor.role ? <p className='text-sm text-ink-muted'>{task.vendor.role}</p> : null}
                </div>
              </div>
              {vendorPhone && task.vendor.phone ? (
                <Button asChild variant='outline'>
                  <a href={vendorPhone}>
                    <Phone aria-hidden />
                    Call <span className='tabular-nums'>{task.vendor.phone}</span>
                  </a>
                </Button>
              ) : null}
            </div>
          </section>
        ) : null}

        {task.instructions ? (
          <section aria-labelledby='instructions-heading'>
            <SectionHeader id='instructions-heading' title='How to do it' />
            <p className={`${CARD} whitespace-pre-line`}>{task.instructions}</p>
          </section>
        ) : null}

        <section aria-labelledby='history-heading'>
          <SectionHeader id='history-heading' title='History' />
          {history.length > 0 ? (
            <HistoryList
              label={`History of ${task.title}`}
              entries={history}
              currency={household.currency}
              memberNames={names}
              canManage={canManage}
              showTask={false}
            />
          ) : (
            <p className={EMPTY_CARD}>Not done yet. Mark it done and the date is recorded here.</p>
          )}
        </section>

        {canManage ? (
          <div className='border-t border-line pt-6'>
            <DeleteTask taskId={task.id} title={task.title} redirectTo={task.assetId ? `/home/assets/${task.assetId}` : '/home'} />
          </div>
        ) : null}
      </div>
    </>
  )
}
