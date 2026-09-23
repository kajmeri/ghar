import type { Bill } from '@ghar/contracts'
import type { CalendarDate } from '@ghar/core/dates'
import { DataList } from '@/app/(app)/_components/ui/data-list'
import { Pill } from '@/components/ui/pill'
import { billAmountText, billScheduleText, billTone, occurrenceText } from '@/lib/bills/display'

/** Late bills first, each with whether it's paid. */
export function BillList({ bills, currency, today }: { bills: Bill[]; currency: string; today: CalendarDate }) {
  return (
    <DataList
      label='Bills'
      rows={bills}
      rowKey={bill => bill.id}
      href={bill => `/bills/${bill.id}`}
      primary={{ header: 'Bill', cell: bill => bill.name }}
      secondary={bill => [billScheduleText(bill), bill.autopay ? 'Autopay' : null].filter(Boolean).join(' · ')}
      columns={[
        {
          id: 'status',
          header: 'Status',
          cell: bill =>
            bill.current ? (
              <Pill tone={billTone(bill)}>{occurrenceText(bill.current, today)}</Pill>
            ) : (
              <span className='text-ink-muted'>Nothing due yet</span>
            ),
        },
        { id: 'payee', header: 'Paid to', showFrom: 'lg', stacked: false, cell: bill => bill.payee },
      ]}
      trailing={{
        header: 'Amount',
        cell: bill => <span className='font-medium tabular-nums'>{billAmountText(bill, currency)}</span>,
      }}
    />
  )
}
