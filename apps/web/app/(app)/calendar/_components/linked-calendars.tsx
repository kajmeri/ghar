import type { CalendarLink } from '@ghar/contracts'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CONNECT_HREF, linkSyncedText } from '@/lib/calendar/display'
import { SectionHeader } from '../../_components/ui/section-header'
import { DisconnectCalendar } from './disconnect-calendar'
import { SyncNow } from './sync-now'

const CARD = 'rounded-card border border-line bg-surface p-4 md:p-6'

export function LinkedCalendars({
  links,
  timeZone,
  canManage,
  canManageOthers,
}: {
  links: CalendarLink[]
  timeZone: string
  canManage: boolean
  /** Owners may disconnect anyone's link; everyone else only their own. */
  canManageOthers: boolean
}) {
  const syncable = links.some(link => link.status !== 'needs_reconnect')

  return (
    <section aria-labelledby='linked-heading'>
      <SectionHeader
        id='linked-heading'
        title='Linked calendars'
        description='Each person links their own Google Calendar. Its events show here read-only and sync every morning.'
        action={
          canManage ? (
            <Button asChild variant='outline'>
              <a href={CONNECT_HREF}>{links.some(link => link.mine) ? 'Link another Google account' : 'Link Google Calendar'}</a>
            </Button>
          ) : undefined
        }
      />
      {links.length === 0 ? (
        <p className={`${CARD} text-ink-muted`}>
          {canManage
            ? 'None yet. Link your Google Calendar and your events show up alongside the household’s.'
            : 'None yet. An adult in your household can link their Google Calendar.'}
        </p>
      ) : (
        <ul className='divide-y divide-line rounded-card border border-line bg-surface'>
          {links.map(link => (
            <li key={link.id} className='flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between'>
              <div className='min-w-0'>
                <p className='font-medium break-words'>
                  {link.accountEmail}
                  {link.mine ? <span className='font-normal text-ink-muted'> · Yours</span> : null}
                </p>
                <LinkStatus link={link} timeZone={timeZone} />
              </div>
              <div className='flex shrink-0 flex-col gap-2 md:flex-row'>
                {link.status === 'needs_reconnect' && link.mine ? (
                  <Button asChild>
                    <a href={CONNECT_HREF}>Reconnect</a>
                  </Button>
                ) : null}
                {canManage && (link.mine || canManageOthers) ? (
                  <DisconnectCalendar linkId={link.id} accountEmail={link.accountEmail} mine={link.mine} />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canManage && syncable ? (
        <div className='mt-3'>
          <SyncNow />
        </div>
      ) : null}
    </section>
  )
}

function LinkStatus({ link, timeZone }: { link: CalendarLink; timeZone: string }) {
  if (link.status === 'active') {
    return <p className='text-sm text-ink-muted'>{linkSyncedText(link, timeZone)}</p>
  }
  const message =
    link.status === 'needs_reconnect'
      ? link.mine
        ? 'Google stopped accepting this link. Reconnect to keep its events up to date.'
        : 'Google stopped accepting this link. Only its owner can reconnect it.'
      : (link.lastError ?? 'The last sync didn’t finish. It tries again every morning.')
  return (
    <p className='flex items-start gap-1.5 text-sm text-ink'>
      <TriangleAlert aria-hidden className='mt-0.5 size-4 shrink-0 text-caution-ink' />
      <span className='min-w-0'>
        {message}
        {link.lastSyncedAt === null ? null : <span className='text-ink-muted'> {linkSyncedText(link, timeZone)}.</span>}
      </span>
    </p>
  )
}
