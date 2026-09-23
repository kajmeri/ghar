import { billParamsSchema, type BillOccurrence } from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import { addCalendarDays, formatCalendarDate, todayInTimeZone, type CalendarDate } from '@ghar/core/dates'
import { NotFoundError } from '@ghar/core/errors'
import { formatCents } from '@ghar/core/money'
import { ExternalLink } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/pill'
import { getPageSession } from '@/lib/api/authed'
import { billAmountText, billScheduleText, billTone, occurrenceText, occurrenceTone } from '@/lib/bills/display'
import * as bills from '@/lib/bills/service'
import { BackLink } from '../../_components/ui/back-link'
import { PageHeader } from '../../_components/ui/page-header'
import { SectionHeader } from '../../_components/ui/section-header'
import { BillSheet } from '../_components/bill-sheet'
import { DeleteBill } from '../_components/delete-bill'
import { FinancesLocked } from '../_components/finances-locked'
import { MarkPaid } from '../_components/mark-paid'

export const metadata: Metadata = { title: 'Bill' }

const CARD = 'rounded-card border border-line bg-surface p-4 md:p-6'
const EMPTY_CARD = 'rounded-card border border-line bg-surface p-4 text-ink-muted'
/** A due date this close can be marked paid ahead of time. Further out, it's clutter. */
const MARK_AHEAD_DAYS = 31

/** Unpaid and due by `until`, or marked paid by hand. A payment matched from a transaction can't be unmarked. */
function isMarkable(occurrence: BillOccurrence, until: CalendarDate): boolean {
  if (occurrence.payment) return occurrence.payment.transactionId === null
  return occurrence.dueOn <= until
}

export default async function BillPage({ params }: PageProps<'/bills/[billId]'>) {
  const { billId } = await params
  if (!billParamsSchema.safeParse({ billId }).success) notFound()
  const session = await getPageSession()
  const { role } = session.context

  if (!can(role, 'finances.view')) {
    return (
      <>
        <BackLink href='/bills'>Bills</BackLink>
        <PageHeader title='Bill' />
        <FinancesLocked />
      </>
    )
  }

  const canManage = can(role, 'finances.manage')
  const [{ currency, bill, occurrences }, options] = await Promise.all([
    bills.getBillDetail(session, billId).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound()
      throw error
    }),
    canManage ? bills.listBillFormOptions(session) : null,
  ])
  const today = todayInTimeZone(session.household.timeZone)
  const markableUntil = addCalendarDays(today, MARK_AHEAD_DAYS)
  const { current, lastPayment } = bill

  const rows: { label: string; value: ReactNode }[] = [
    {
      label: 'Status',
      value: current ? (
        <Pill tone={billTone(bill)}>{occurrenceText(current, today)}</Pill>
      ) : (
        <span className='text-ink-muted'>Nothing due yet</span>
      ),
    },
    current && current.status !== 'paid' ? { label: 'Due', value: formatCalendarDate(current.dueOn) } : null,
    { label: 'Amount', value: <span className='tabular-nums'>{billAmountText(bill, currency)}</span> },
    {
      label: 'Last paid',
      value: lastPayment ? (
        <span className='tabular-nums'>
          {lastPayment.amountCents === null
            ? `Marked paid on ${formatCalendarDate(lastPayment.paidOn)}`
            : `${formatCents(lastPayment.amountCents, { currency })} on ${formatCalendarDate(lastPayment.paidOn)}`}
        </span>
      ) : (
        <span className='text-ink-muted'>No payment found yet</span>
      ),
    },
    { label: 'Paid to', value: bill.payee },
    { label: 'Paid from', value: bill.accountName ?? 'Any account' },
    { label: 'Autopay', value: bill.autopay ? 'On' : 'Off' },
  ].filter(row => row !== null)

  return (
    <>
      <BackLink href='/bills'>Bills</BackLink>
      <PageHeader
        title={bill.name}
        description={billScheduleText(bill)}
        action={
          bill.url || options ? (
            <>
              {bill.url ? (
                <Button asChild>
                  <a href={bill.url} target='_blank' rel='noopener noreferrer'>
                    <ExternalLink aria-hidden />
                    Pay online
                  </a>
                </Button>
              ) : null}
              {options ? <BillSheet bill={bill} options={options} currency={currency} /> : null}
            </>
          ) : undefined
        }
      />

      <div className='flex flex-col gap-8'>
        <div className='flex flex-col gap-2'>
          <dl aria-label='Status' className='divide-y divide-line rounded-card border border-line bg-surface'>
            {rows.map(row => (
              <div key={row.label} className='flex items-start justify-between gap-4 px-4 py-3'>
                <dt className='shrink-0 text-ink-muted'>{row.label}</dt>
                <dd className='min-w-0 text-right break-words'>{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className='text-sm text-ink-muted'>
            It’s marked paid when a payment to “{bill.payee}”
            {bill.amountCents === null ? '' : bill.isVariable ? ' for roughly the usual amount' : ' for the usual amount'} shows up in
            your transactions within a few days of the due date.{canManage ? ' Paid some other way? Mark the due date paid below.' : ''}
          </p>
        </div>

        <section aria-labelledby='due-dates-heading'>
          <SectionHeader id='due-dates-heading' title='Due dates' description='The past year and the next one' />
          {occurrences.length > 0 ? (
            <ul aria-label={`Due dates for ${bill.name}`} className='divide-y divide-line rounded-card border border-line bg-surface'>
              {occurrences.map(occurrence => (
                <li key={occurrence.dueOn} className='flex items-center justify-between gap-4 px-4 py-3'>
                  <div className='min-w-0'>
                    <p className='font-medium tabular-nums'>{formatCalendarDate(occurrence.dueOn)}</p>
                    {occurrence.payment ? (
                      <p className='text-sm text-ink-muted tabular-nums'>
                        {occurrence.payment.amountCents === null
                          ? `Marked paid on ${formatCalendarDate(occurrence.payment.paidOn)}`
                          : formatCents(occurrence.payment.amountCents, { currency })}
                      </p>
                    ) : null}
                    {canManage && isMarkable(occurrence, markableUntil) ? (
                      <MarkPaid billId={bill.id} dueOn={occurrence.dueOn} marked={occurrence.payment !== null} />
                    ) : null}
                  </div>
                  <Pill tone={occurrenceTone(occurrence)}>{occurrenceText(occurrence, today)}</Pill>
                </li>
              ))}
            </ul>
          ) : (
            <p className={EMPTY_CARD}>No due dates yet. The next one shows up here as it gets close.</p>
          )}
        </section>

        {bill.notes ? (
          <section aria-labelledby='notes-heading'>
            <SectionHeader id='notes-heading' title='Notes' />
            <p className={`${CARD} break-words whitespace-pre-line`}>{bill.notes}</p>
          </section>
        ) : null}

        {canManage ? (
          <div className='border-t border-line pt-6'>
            <DeleteBill billId={bill.id} name={bill.name} />
          </div>
        ) : null}
      </div>
    </>
  )
}
