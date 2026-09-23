import { formatPeriod, addMonths } from '@ghar/core/finances'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { budgetHref } from '@/lib/finances/display'

const STEP =
  'inline-flex size-tap shrink-0 items-center justify-center rounded-control border border-line bg-surface text-ink transition-colors hover:bg-paper focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'

/** Which month the page is showing, and the way to the ones either side of it. */
export function MonthNav({ periodStart }: { periodStart: string }) {
  return (
    <nav aria-label='Month' className='flex items-center justify-between gap-3'>
      <Link href={budgetHref(addMonths(periodStart, -1))} className={STEP}>
        <ChevronLeft aria-hidden />
        <span className='sr-only'>The month before</span>
      </Link>
      <p aria-current='page' className='min-w-0 truncate text-lg font-semibold'>
        {formatPeriod(periodStart)}
      </p>
      <Link href={budgetHref(addMonths(periodStart, 1))} className={STEP}>
        <ChevronRight aria-hidden />
        <span className='sr-only'>The month after</span>
      </Link>
    </nav>
  )
}
