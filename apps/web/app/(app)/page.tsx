import { can } from '@ghar/core/auth'
import { formatCalendarDate, formatInstant } from '@ghar/core/dates'
import { expiryPhrase } from '@ghar/core/documents'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/pill'
import { getPageSession } from '@/lib/api/authed'
import { getAttention } from '@/lib/attention/service'
import { getPageContext } from '@/lib/auth/context'
import { billAmountText, billTone, occurrenceText } from '@/lib/bills/display'
import { EXPIRY_TONES } from '@/lib/documents/display'
import * as households from '@/lib/households/service'
import { EmptyState } from './_components/ui/empty-state'
import { ChecklistIllustration, PeopleIllustration } from './_components/ui/illustrations'
import { PageHeader } from './_components/ui/page-header'
import { ROW_LINK } from './_components/ui/row-link'
import { SectionHeader } from './_components/ui/section-header'
import { JobList } from './home/_components/job-list'

export const metadata: Metadata = { title: 'Home' }

const LIST = 'divide-y divide-line overflow-hidden rounded-card border border-line bg-surface'
const ROW = 'relative flex items-start justify-between gap-4 px-4 py-3 transition-colors hover:bg-paper'

export default async function HomePage() {
  const { ctx, session: sessionContext } = await getPageContext()
  const session = await getPageSession()
  const [{ household }, members, attention] = await Promise.all([
    households.getMyHousehold(ctx, sessionContext),
    households.listMembers(ctx),
    getAttention(session),
  ])
  const inviteFirst = can(ctx.role, 'members.invite') && members.length < 2
  const { today, currency, maintenance, expiries } = attention
  const bills = attention.bills ?? []
  const header = <PageHeader title={household.name} description={formatInstant(new Date(), household.timezone, { dateStyle: 'full' })} />

  if (maintenance.length === 0 && bills.length === 0 && expiries.length === 0) {
    return (
      <>
        {header}
        {inviteFirst ? (
          <EmptyState
            illustration={<PeopleIllustration />}
            title='Ghar works best shared'
            description='Invite the people you live with so everyone sees the same bills, plans and reminders.'
            action={
              <Button asChild>
                <Link href='/settings/household'>Invite someone</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            illustration={<ChecklistIllustration />}
            title='Nothing needs you today'
            description='Late bills, house jobs coming due and papers about to expire land here, so for now make sure everyone you live with has joined.'
            action={
              <Button asChild variant='outline'>
                <Link href='/settings/household'>View household</Link>
              </Button>
            }
          />
        )}
      </>
    )
  }

  return (
    <>
      {header}
      <div className='flex flex-col gap-8'>
        {bills.length > 0 ? (
          <section aria-labelledby='bills-heading'>
            <SectionHeader
              id='bills-heading'
              title='Bills'
              description='Late, or due this week and not paid yet'
              action={
                <Button asChild variant='ghost'>
                  <Link href='/bills'>All bills</Link>
                </Button>
              }
            />
            <ul aria-label='Bills that need paying' className={LIST}>
              {bills.map(bill => (
                <li key={bill.id} className={ROW}>
                  <div className='min-w-0'>
                    <p className='font-medium break-words'>
                      <Link href={`/bills/${bill.id}`} className={ROW_LINK}>
                        {bill.name}
                      </Link>
                    </p>
                    {bill.autopay ? <p className='text-sm text-ink-muted'>Autopay</p> : null}
                    {bill.current ? (
                      <p className='mt-1'>
                        <Pill tone={billTone(bill)}>{occurrenceText(bill.current, today)}</Pill>
                      </p>
                    ) : null}
                  </div>
                  <p className='shrink-0 font-medium tabular-nums'>{billAmountText(bill, currency)}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {maintenance.length > 0 ? (
          <section aria-labelledby='jobs-heading'>
            <SectionHeader
              id='jobs-heading'
              title='House jobs'
              description='Overdue or due in the next two weeks'
              action={
                <Button asChild variant='ghost'>
                  <Link href='/home'>All jobs</Link>
                </Button>
              }
            />
            <JobList label='House jobs coming due' tasks={maintenance} today={today} canManage={can(ctx.role, 'home.manage')} />
          </section>
        ) : null}

        {expiries.length > 0 ? (
          <section aria-labelledby='expiries-heading'>
            <SectionHeader
              id='expiries-heading'
              title='Expiring'
              description='Passports, policies and warranties'
              action={
                <Button asChild variant='ghost'>
                  <Link href='/documents'>All documents</Link>
                </Button>
              }
            />
            <ul aria-label='Papers and warranties expiring' className={LIST}>
              {expiries.map(expiry => {
                const href = expiry.kind === 'document' ? `/documents/${expiry.documentId}` : `/home/assets/${expiry.assetId}`
                return (
                  <li key={href} className={ROW}>
                    <div className='min-w-0'>
                      <p className='font-medium break-words'>
                        <Link href={href} className={ROW_LINK}>
                          {expiry.kind === 'warranty' ? `${expiry.title} warranty` : expiry.title}
                        </Link>
                      </p>
                      <p className='text-sm text-ink-muted tabular-nums'>{formatCalendarDate(expiry.expiresOn)}</p>
                    </div>
                    <Pill tone={EXPIRY_TONES[expiry.state]}>{expiryPhrase(expiry.expiresOn, today)}</Pill>
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}

        {inviteFirst ? (
          <p className='rounded-card border border-line bg-surface p-4 text-ink-muted'>
            Ghar works best shared.{' '}
            <Link href='/settings/household' className='text-ink underline underline-offset-4 hover:text-ink-muted'>
              Invite the people you live with
            </Link>{' '}
            so they see the same reminders.
          </p>
        ) : null}
      </div>
    </>
  )
}
