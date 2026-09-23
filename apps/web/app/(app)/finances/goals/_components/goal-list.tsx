'use client'

import type { Account, Goal } from '@ghar/contracts'
import { formatCents } from '@ghar/core/money'
import { useState } from 'react'
import { GoalDetail } from './goal-detail'
import { GoalSheet } from './goal-sheet'
import { SavedBar } from './saved-bar'

const CARD = 'block w-full rounded-card border border-line bg-surface p-4 text-left md:p-5'
const TAPPABLE = 'transition-colors hover:bg-paper focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'

/** Every goal, each against the account behind it. A row opens the goal for editing. */
export function GoalList({
  goals,
  accounts,
  currency,
  today,
  canManage,
}: {
  goals: Goal[]
  accounts: Account[]
  currency: string
  today: string
  canManage: boolean
}) {
  const [editing, setEditing] = useState<Goal | null>(null)
  const money = (cents: number) => formatCents(cents, { currency })

  return (
    <>
      <ul className='flex flex-col gap-3'>
        {goals.map(goal => {
          const body = (
            <>
              <SavedBar
                label={goal.name}
                savedCents={goal.savedCents}
                targetCents={goal.targetCents}
                valueText={
                  goal.savedCents === null ? `${money(goal.targetCents)} target` : `${money(goal.savedCents)} of ${money(goal.targetCents)}`
                }
                detail={<GoalDetail goal={goal} currency={currency} />}
              />
              {goal.accountLabel === null ? null : <p className='mt-2 text-sm text-ink-muted'>In {goal.accountLabel}</p>}
            </>
          )
          return (
            <li key={goal.id}>
              {canManage ? (
                <button
                  type='button'
                  className={`${CARD} ${TAPPABLE}`}
                  onClick={() => {
                    setEditing(goal)
                  }}
                >
                  {body}
                  <span className='sr-only'>Edit this goal</span>
                </button>
              ) : (
                <div className={CARD}>{body}</div>
              )}
            </li>
          )
        })}
      </ul>

      {/* Keyed on the goal, so the form always opens on the one that was tapped. */}
      {editing ? (
        <GoalSheet
          key={editing.id}
          goal={editing}
          accounts={accounts}
          currency={currency}
          today={today}
          open
          onOpenChange={next => {
            if (!next) setEditing(null)
          }}
        />
      ) : null}
    </>
  )
}
