import type { MailLink } from '@ghar/contracts'
import { formatInstant } from '@ghar/core/dates'
import { MAIL_FIRST_LOOKBACK_DAYS } from '@ghar/core/mail'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GMAIL_CONNECT_HREF } from '@/lib/mail/display'
import { SectionHeader } from '../../../../_components/ui/section-header'
import { CheckMail } from './check-mail'
import { DisconnectGmail } from './disconnect-gmail'

const CARD = 'rounded-card border border-line bg-surface p-4 md:p-6'

/** The signed-in person's Gmail: link it, see when it was last checked, check now or disconnect. */
export function GmailLink({ link, timeZone }: { link: MailLink | null; timeZone: string }) {
  return (
    <section aria-labelledby='gmail-heading'>
      <SectionHeader
        id='gmail-heading'
        title='Gmail'
        description='Checked every morning for flight, hotel and rental confirmations. Ghar asks Google for read-only access and opens only mail from travel companies.'
        action={
          link ? undefined : (
            <Button asChild>
              <a href={GMAIL_CONNECT_HREF}>Link Gmail</a>
            </Button>
          )
        }
      />
      {link ? (
        <>
          <div className={`${CARD} flex flex-col gap-3 md:flex-row md:items-center md:justify-between`}>
            <div className='min-w-0'>
              <p className='font-medium break-words'>{link.accountEmail}</p>
              <LinkStatus link={link} timeZone={timeZone} />
            </div>
            <div className='flex shrink-0 flex-col gap-2 md:flex-row'>
              {link.status === 'needs_reconnect' ? (
                <Button asChild>
                  <a href={GMAIL_CONNECT_HREF}>Reconnect</a>
                </Button>
              ) : null}
              <DisconnectGmail accountEmail={link.accountEmail} />
            </div>
          </div>
          {link.status === 'active' ? (
            <div className='mt-3'>
              <CheckMail />
            </div>
          ) : null}
        </>
      ) : (
        <p className={`${CARD} text-ink-muted`}>
          Not linked. Link your Gmail and the bookings in your last {String(MAIL_FIRST_LOOKBACK_DAYS)} days of mail show up here to check.
        </p>
      )}
    </section>
  )
}

function LinkStatus({ link, timeZone }: { link: MailLink; timeZone: string }) {
  const checked =
    link.lastCheckedAt === null
      ? 'Not checked yet'
      : `Checked ${formatInstant(new Date(link.lastCheckedAt), timeZone, { dateStyle: 'medium', timeStyle: 'short' })}`
  const problem = link.status === 'needs_reconnect' ? 'Google stopped accepting this link. Reconnect to keep checking.' : link.lastError
  if (problem === null) return <p className='text-sm text-ink-muted'>{checked}</p>
  return (
    <p className='flex items-start gap-1.5 text-sm text-ink'>
      <TriangleAlert aria-hidden className='mt-0.5 size-4 shrink-0 text-caution-ink' />
      <span className='min-w-0'>
        {problem} <span className='text-ink-muted'>{checked}.</span>
      </span>
    </p>
  )
}
