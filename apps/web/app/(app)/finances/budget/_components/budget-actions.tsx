'use client'

import { closeBudgetMonth, copyPreviousBudget, type BudgetMonth, type Category } from '@ghar/contracts'
import { formatPeriod } from '@ghar/core/finances'
import { CopyPlus, Lock, Plus } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '@/app/(app)/_components/ui/confirm-dialog'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { BudgetLineSheet } from './budget-line-sheet'

/**
 * What can be done to the month: plan another category, bring last month's plan across, and once
 * the month has ended, close it so later bank changes can't rewrite what it did.
 */
export function BudgetActions({
  month,
  choices,
  range,
  currency,
  label = 'Plan a category',
}: {
  month: BudgetMonth
  /** The categories with no line yet. */
  choices: Category[]
  range: { from: string; to: string }
  currency: string
  /** The wording on the add button, which is the only action an empty month shows. */
  label?: string
}) {
  const [adding, setAdding] = useState(false)

  const copy = useMutation(async () => {
    await api.request(copyPreviousBudget, { body: { periodStart: month.periodStart } })
  })
  const close = useMutation(async () => {
    await api.request(closeBudgetMonth, { body: { periodStart: month.periodStart } })
  })

  if (month.closedAt !== null) return null

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-col gap-3 sm:flex-row sm:flex-wrap'>
        <BudgetLineSheet
          periodStart={month.periodStart}
          choices={choices}
          range={range}
          currency={currency}
          open={adding}
          onOpenChange={setAdding}
          trigger={
            <Button disabled={choices.length === 0}>
              <Plus aria-hidden />
              {label}
            </Button>
          }
        />
        {month.previousHasLines ? (
          <Button
            variant='outline'
            disabled={copy.pending}
            onClick={() => {
              copy.mutate()
            }}
          >
            <CopyPlus aria-hidden />
            {copy.pending ? 'Copying…' : 'Copy last month'}
          </Button>
        ) : null}
        {month.canClose ? (
          <ConfirmDialog
            trigger={
              <Button variant='outline' disabled={close.pending}>
                <Lock aria-hidden />
                {close.pending ? 'Closing…' : 'Close the month'}
              </Button>
            }
            title={`Close ${formatPeriod(month.periodStart)}?`}
            description='Its figures are kept as they stand now, anything left over carries into next month, and the plan can’t change after.'
            confirmLabel='Close the month'
            onConfirm={() => {
              close.mutate()
            }}
          />
        ) : null}
      </div>
      {choices.length === 0 ? <p className='text-sm text-ink-muted'>Every expense category is already planned for.</p> : null}
      <FormError>{copy.error ?? close.error}</FormError>
    </div>
  )
}
