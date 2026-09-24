'use client'

import type { BudgetLine, BudgetMonth } from '@ghar/contracts'
import { formatCents } from '@ghar/core/money'
import { useState } from 'react'
import { ProgressBar } from '@/app/(app)/_components/ui/progress-bar'
import { BudgetLineSheet } from './budget-line-sheet'

const CARD = 'block w-full rounded-card border border-line bg-surface p-4 text-left md:p-5'
const TAPPABLE = 'transition-colors hover:bg-paper focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'

/**
 * Every planned category, each against what it has spent. A row opens the plan for editing; a
 * closed month, or someone who can only look, gets the same rows without the tap.
 */
export function BudgetLines({
  month,
  range,
  currency,
  canManage,
}: {
  month: BudgetMonth
  range: { from: string; to: string }
  currency: string
  canManage: boolean
}) {
  const [editing, setEditing] = useState<BudgetLine | null>(null)
  const editable = canManage && month.closedAt === null
  const money = (cents: number) => formatCents(cents, { currency })

  return (
    <>
      <ul className='flex flex-col gap-3'>
        {month.lines.map(line => {
          const bar = (
            <ProgressBar
              label={line.categoryName}
              value={line.actualCents}
              max={line.availableCents}
              valueText={`${money(line.actualCents)} of ${money(line.availableCents)}`}
              detail={line.remainingCents >= 0 ? `${money(line.remainingCents)} left` : `${money(-line.remainingCents)} over`}
              marker={month.closedAt === null ? month.elapsedShare : undefined}
            />
          )
          return (
            <li key={line.id}>
              {editable ? (
                <button
                  type='button'
                  className={`${CARD} ${TAPPABLE}`}
                  onClick={() => {
                    setEditing(line)
                  }}
                >
                  {bar}
                  <span className='sr-only'>Change this plan</span>
                </button>
              ) : (
                <div className={CARD}>{bar}</div>
              )}
            </li>
          )
        })}
      </ul>

      {/* Keyed on the line, so the form always opens on the one that was tapped. */}
      {editing ? (
        <BudgetLineSheet
          key={editing.id}
          periodStart={month.periodStart}
          line={editing}
          range={range}
          currency={currency}
          open
          onOpenChange={next => {
            if (!next) setEditing(null)
          }}
        />
      ) : null}
    </>
  )
}
