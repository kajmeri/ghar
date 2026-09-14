import { formatMonth, shiftMonth, type FeedSource, type MonthKey } from '@ghar/core/calendar'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { calendarHref } from '@/lib/calendar/display'

export function MonthNav({
  month,
  currentMonth,
  sources,
  available,
}: {
  month: MonthKey
  currentMonth: MonthKey
  sources: FeedSource[]
  available: FeedSource[]
}) {
  const href = (target: MonthKey) => calendarHref({ month: target === currentMonth ? null : target, sources, available })
  const previous = shiftMonth(month, -1)
  const next = shiftMonth(month, 1)

  return (
    <div className='flex items-center justify-between gap-3'>
      <h2 className='text-lg font-semibold'>{formatMonth(month)}</h2>
      <div className='flex items-center gap-1'>
        {month === currentMonth ? null : (
          <Button asChild variant='outline' className='mr-1'>
            <Link href={href(currentMonth)}>Today</Link>
          </Button>
        )}
        <Button asChild variant='ghost' size='icon'>
          <Link href={href(previous)} aria-label={`Previous month, ${formatMonth(previous)}`}>
            <ChevronLeft aria-hidden />
          </Link>
        </Button>
        <Button asChild variant='ghost' size='icon'>
          <Link href={href(next)} aria-label={`Next month, ${formatMonth(next)}`}>
            <ChevronRight aria-hidden />
          </Link>
        </Button>
      </div>
    </div>
  )
}
