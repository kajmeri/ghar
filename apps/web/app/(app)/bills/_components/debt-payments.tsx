import type { Debt } from '@ghar/contracts'
import { debtDueTone } from '@ghar/core/calendar'
import type { CalendarDate } from '@ghar/core/dates'
import { formatCents } from '@ghar/core/money'
import { DataList } from '@/app/(app)/_components/ui/data-list'
import { SectionHeader } from '@/app/(app)/_components/ui/section-header'
import { Pill } from '@/components/ui/pill'
import { debtPaymentText } from '@/lib/bills/display'
import { DEBT_KIND_LABELS, NET_WORTH_PATH } from '@/lib/networth/display'

type Payment = Debt & { nextPaymentDueOn: CalendarDate }

const PILL_TONE = { default: 'neutral', caution: 'caution', negative: 'negative' } as const

/** Connected cards and loans with a next payment, soonest first. Plaid reports them; nothing here is marked paid by hand. */
export function DebtPayments({ payments, currency, today }: { payments: readonly Payment[]; currency: string; today: CalendarDate }) {
  return (
    <section aria-labelledby='debt-payments-heading'>
      <SectionHeader
        id='debt-payments-heading'
        title='Card and loan payments'
        description='Next due dates from your connected lenders. They update after each daily sync.'
      />
      <DataList
        label='Card and loan payments'
        rows={payments}
        rowKey={payment => payment.id}
        href={() => `${NET_WORTH_PATH}#debts-heading`}
        primary={{ header: 'Account', cell: payment => payment.name }}
        secondary={payment =>
          [DEBT_KIND_LABELS[payment.kind], payment.institutionName && payment.mask ? `${payment.institutionName} ••${payment.mask}` : payment.institutionName]
            .filter(Boolean)
            .join(' · ')
        }
        columns={[
          {
            id: 'due',
            header: 'Due',
            cell: payment => (
              <Pill tone={PILL_TONE[debtDueTone(payment.nextPaymentDueOn, payment.isOverdue, today)]}>{debtPaymentText(payment, today)}</Pill>
            ),
          },
        ]}
        trailing={{
          header: 'Minimum',
          cell: payment =>
            payment.minimumPaymentCents === null ? (
              <span className='text-ink-muted'>Not shared</span>
            ) : (
              <span className='font-medium tabular-nums'>{formatCents(payment.minimumPaymentCents, { currency })}</span>
            ),
        }}
      />
    </section>
  )
}
