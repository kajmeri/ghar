import { bookingParamsSchema, type BookingDetail } from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import { formatInstant } from '@ghar/core/dates'
import { NotFoundError } from '@ghar/core/errors'
import { formatCents } from '@ghar/core/money'
import { bookingTitle, carrierName } from '@ghar/core/travel'
import { Pencil } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { getPageContext } from '@/lib/auth/context'
import { bookingWhen, CABIN_LABELS, DROP_ACTION_LABELS, KIND_LABELS, ratePlanLabel, STATUS_LABELS } from '@/lib/travel/display'
import * as travel from '@/lib/travel/service'
import { canSimulatePrices } from '@/lib/travel/simulate'
import { PageHeader } from '../../../_components/ui/page-header'
import { SectionHeader } from '../../../_components/ui/section-header'
import { StatCard, StatGroup } from '../../../_components/ui/stat-card'
import { BackLink } from '../_components/back-link'
import { DeleteBooking } from '../_components/delete-booking'
import { PriceChart } from '../_components/price-chart'
import { SimulateForm } from '../_components/simulate-form'
import { WatchToggle } from '../_components/watch-toggle'

export const metadata: Metadata = { title: 'Booking' }

const CARD = 'rounded-card border border-line bg-surface p-4 md:p-6'

export default async function BookingPage({ params }: PageProps<'/travel/bookings/[bookingId]'>) {
  const { bookingId } = await params
  if (!bookingParamsSchema.safeParse({ bookingId }).success) notFound()
  const { ctx } = await getPageContext()
  const canManage = can(ctx.role, 'travel.manage')

  const [detail, { timezone }] = await Promise.all([
    travel.getBookingDetail(ctx, { bookingId }).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound()
      throw error
    }),
    travel.getTravelSettings(ctx),
  ])
  const { booking, price, history, checks, alerts, actionability, alertBelowCents } = detail
  const title = bookingTitle(booking)
  const money = (cents: number) => formatCents(cents, { currency: booking.currency })
  const when = (iso: string) => formatInstant(new Date(iso), timezone, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <>
      <BackLink href='/travel/bookings'>Bookings</BackLink>
      <PageHeader
        title={title}
        description={summary(detail, timezone)}
        action={
          canManage ? (
            <Button asChild variant='outline'>
              <Link href={`/travel/bookings/${booking.id}/edit`}>
                <Pencil aria-hidden />
                Edit booking
              </Link>
            </Button>
          ) : undefined
        }
      />

      <div className='flex flex-col gap-10'>
        <StatGroup>
          <StatCard label='You paid' value={money(booking.paidCents)} />
          <StatCard
            label='Latest price'
            value={price.latest ? money(price.latest.priceCents) : 'Not checked yet'}
            delta={
              price.latest && price.deltaCents !== null
                ? {
                    direction: price.deltaCents < 0 ? 'down' : price.deltaCents > 0 ? 'up' : 'flat',
                    sentiment: price.deltaCents < 0 ? 'positive' : price.deltaCents > 0 ? 'negative' : 'neutral',
                    value: money(Math.abs(price.deltaCents)),
                    label: price.latest.confidence === 'exact' ? 'verified' : 'cached, not verified',
                  }
                : undefined
            }
          />
          <StatCard label='Lowest seen' value={price.lowestCents === null ? 'None yet' : money(price.lowestCents)} />
          <StatCard label='Next email at' value={alertBelowCents === null ? 'No emails' : `${money(alertBelowCents)} or less`} />
        </StatGroup>

        <section aria-labelledby='history-heading'>
          <SectionHeader
            id='history-heading'
            title='Price history'
            description={price.lastCheckedAt ? `Last checked ${when(price.lastCheckedAt)}` : 'Checked every morning'}
          />
          <div className={CARD}>
            {history.length > 0 ? (
              <PriceChart history={history} paidCents={booking.paidCents} alertBelowCents={alertBelowCents} currency={booking.currency} />
            ) : (
              <p className='text-ink-muted'>
                {detail.watchable
                  ? 'No prices yet. The first check runs tomorrow morning.'
                  : 'No prices yet, and this booking isn’t being checked.'}
              </p>
            )}
          </div>
        </section>

        <section aria-labelledby='watch-heading'>
          <SectionHeader id='watch-heading' title='Price watch' />
          <div className={`flex flex-col gap-4 ${CARD}`}>
            {canManage ? (
              <WatchToggle bookingId={booking.id} watchEnabled={booking.watchEnabled} label='Watch for price drops' />
            ) : (
              <p>{booking.watchEnabled ? 'The watch is on.' : 'The watch is off.'}</p>
            )}
            {watchNote(detail) ? <p className='text-ink-muted'>{watchNote(detail)}</p> : null}
            <div className='flex flex-col gap-1 border-t border-line pt-4'>
              <p className='font-medium'>
                {actionability.actionable && actionability.action
                  ? `If the price drops, you can ${DROP_ACTION_LABELS[actionability.action]}.`
                  : 'No emails about drops on this booking.'}
              </p>
              <p className='text-ink-muted'>{actionability.reason}</p>
              <p className='mt-2 text-sm text-ink-muted'>
                Fare and rate rules change. The rules on your own ticket or reservation are what count.
              </p>
            </div>
          </div>
        </section>

        {canManage && canSimulatePrices() ? (
          <section aria-labelledby='simulate-heading'>
            <SectionHeader
              id='simulate-heading'
              title='Simulate a price'
              description='Development only. Sets what the fake provider quotes for this booking, then runs the morning check for the whole household.'
            />
            <SimulateForm bookingId={booking.id} currency={booking.currency} />
          </section>
        ) : null}

        <section aria-labelledby='checks-heading'>
          <SectionHeader
            id='checks-heading'
            title='Recent checks'
            description='A cached price is a cheap first look. A drop is verified with an exact quote before anyone gets an email.'
          />
          {checks.length === 0 ? (
            <p className={`${CARD} text-ink-muted`}>No checks yet. Every check shows up here, including ones that fail.</p>
          ) : (
            <ul className='divide-y divide-line rounded-card border border-line bg-surface'>
              {checks.map(check => (
                <li key={check.id} className='flex items-start justify-between gap-4 px-4 py-3'>
                  <div className='min-w-0'>
                    <p>{when(check.checkedAt)}</p>
                    <p className='text-sm break-words text-ink-muted'>
                      {check.confidence === 'exact' ? 'Exact quote' : 'Cached price'} · {check.provider}
                      {check.error ? ` · ${check.error}` : ''}
                    </p>
                  </div>
                  <p className='shrink-0 text-right font-medium'>
                    {check.success && check.priceCents !== null ? money(check.priceCents) : <span className='text-negative'>Failed</span>}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby='alerts-heading'>
          <SectionHeader id='alerts-heading' title='Emails sent' />
          {alerts.length === 0 ? (
            <p className={`${CARD} text-ink-muted`}>
              None yet. An email goes out when a verified price is under{' '}
              {alertBelowCents === null ? 'a level you could claim' : money(alertBelowCents)}.
            </p>
          ) : (
            <ul className='divide-y divide-line rounded-card border border-line bg-surface'>
              {alerts.map(alert => (
                <li key={alert.id} className='flex items-start justify-between gap-4 px-4 py-3'>
                  <div className='min-w-0'>
                    <p>{when(alert.sentAt)}</p>
                    <p className='text-sm text-ink-muted'>Price was {money(alert.priceCents)}</p>
                  </div>
                  <p className='shrink-0 text-right font-medium text-positive'>{money(Math.abs(alert.deltaCents))} cheaper</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {canManage ? (
          <div className='border-t border-line pt-6'>
            <DeleteBooking bookingId={booking.id} title={title} />
          </div>
        ) : null}
      </div>
    </>
  )
}

function summary({ booking }: BookingDetail, timeZone: string): string {
  const details =
    booking.kind === 'flight'
      ? [carrierName(booking.carrier), booking.cabin ? CABIN_LABELS[booking.cabin] : null]
      : [KIND_LABELS[booking.kind], booking.ratePlan ? ratePlanLabel(booking.ratePlan, booking.kind) : null]
  return [
    ...details,
    bookingWhen(booking, timeZone, { withTime: true }),
    booking.confirmationCode,
    booking.status === 'booked' ? null : STATUS_LABELS[booking.status],
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Why the morning check skips this booking, if it does. */
function watchNote({ booking, watchable }: BookingDetail): string | null {
  if (watchable) return null
  if (booking.status !== 'booked') {
    return `Not checked: this booking is ${STATUS_LABELS[booking.status].toLowerCase()}.`
  }
  if (!booking.watchEnabled) return 'Not checked while the watch is off.'
  return 'Not checked: the trip has started.'
}
