import type { Goal } from '@ghar/contracts'
import { formatCalendarDate } from '@ghar/core/dates'
import { formatCents } from '@ghar/core/money'
import { CircleCheck, TriangleAlert } from 'lucide-react'

/** The line under a goal's bar: what is left, by when, and what that asks for each month. */
export function GoalDetail({ goal, currency }: { goal: Goal; currency: string }) {
  const money = (cents: number) => formatCents(cents, { currency })
  const by = goal.targetDate === null ? null : formatCalendarDate(goal.targetDate, 'MMMM yyyy')

  if (goal.savedCents === null) {
    return <span>Link an account and its balance follows this one{by === null ? '' : `, due by ${by}`}.</span>
  }
  if (goal.reached) {
    return (
      <span className='flex items-center gap-1.5 text-positive'>
        <CircleCheck aria-hidden className='size-4 shrink-0' />
        Reached{by === null ? '' : `, in time for ${by}`}
      </span>
    )
  }

  const left = `${money(goal.remainingCents ?? 0)} to go`
  if (goal.overdue) {
    return (
      <span className='flex items-center gap-1.5 text-ink'>
        <TriangleAlert aria-hidden className='size-4 shrink-0 text-caution-ink' />
        {left}, and {by} has gone by
      </span>
    )
  }
  if (goal.perMonthCents === null || by === null) return <span>{left}</span>
  return (
    <span>
      {left} · {money(goal.perMonthCents)} a month to have it by {by}
    </span>
  )
}
