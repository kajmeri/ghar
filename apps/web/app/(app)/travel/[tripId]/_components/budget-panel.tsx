'use client'

import { listTransactions, tagTransaction, type TripTransaction } from '@ghar/contracts'
import { formatCalendarDate } from '@ghar/core/dates'
import { formatCents } from '@ghar/core/money'
import { tripBudget, type BudgetState } from '@ghar/core/trips'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { FormError } from '@/components/ui/form-error'
import { Meter } from '@/components/ui/meter'
import { Pill, type PillTone } from '@/components/ui/pill'
import { useMutation } from '@/hooks/use-mutation'
import { api, errorMessage } from '@/lib/api/client'
import { NewExpenseForm } from './new-expense-form'

interface Budget {
  tripId: string
  plannedCents: number | null
  actualCents: number
  committedCents: number
  transactions: TripTransaction[]
}

const TONE: Record<BudgetState, PillTone> = {
  unset: 'neutral',
  under: 'positive',
  close: 'caution',
  over: 'negative',
}

const HEADLINE: Record<BudgetState, string> = {
  unset: 'No budget set',
  under: 'Under budget',
  close: 'Close to the limit',
  over: 'Over budget',
}

/**
 * Planned against actual. Planned is what the household said; actual is what the cards
 * say, from transactions tagged to this trip. Committed is what the plan still expects to
 * cost and has not been paid yet, which is why it sits apart from both.
 */
export function BudgetPanel({
  budget,
  tripName,
  today,
  canSeeCharges,
}: {
  budget: Budget
  tripName: string
  today: string
  /** The charges are finances data. Without finances access the total shows on its own. */
  canSeeCharges: boolean
}) {
  const summary = tripBudget(budget)
  const tone = TONE[summary.state]

  return (
    <div className='flex flex-col gap-5'>
      <Card className='flex flex-col gap-4 p-5'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <p className='amount text-3xl'>{formatCents(summary.actualCents)}</p>
            <p className='mt-1 text-sm text-ink-muted'>
              {summary.plannedCents === null ? 'spent so far' : `spent of ${formatCents(summary.plannedCents)}`}
            </p>
          </div>
          <Pill tone={tone}>{HEADLINE[summary.state]}</Pill>
        </div>

        {summary.ratioUsed === null ? null : <Meter ratio={summary.ratioUsed} tone={tone} label={`Budget used for ${tripName}`} />}

        <dl className='grid grid-cols-2 gap-4 text-sm md:grid-cols-3'>
          <div>
            <dt className='text-ink-muted'>Planned</dt>
            <dd className='amount text-lg'>{summary.plannedCents === null ? '—' : formatCents(summary.plannedCents)}</dd>
          </div>
          <div>
            <dt className='text-ink-muted'>Left</dt>
            <dd
              className={summary.remainingCents !== null && summary.remainingCents < 0 ? 'amount text-lg text-negative' : 'amount text-lg'}
            >
              {summary.remainingCents === null ? '—' : formatCents(summary.remainingCents)}
            </dd>
          </div>
          <div>
            <dt className='text-ink-muted'>On the plan</dt>
            <dd className='amount text-lg'>{formatCents(summary.committedCents)}</dd>
          </div>
        </dl>
      </Card>

      {canSeeCharges ? (
        <>
          <NewExpenseForm tripId={budget.tripId} today={today} />
          <TaggedTransactions budget={budget} />
          {/*
            The untagged list is fetched by the browser, so it has no way to know a tag changed
            on the server. Keying it on what is tagged now remounts it when that happens, which
            is a lot less machinery than a shared cache for two lists on one page.
          */}
          <UntaggedTransactions key={budget.transactions.map(transaction => transaction.id).join(',')} tripId={budget.tripId} />
        </>
      ) : (
        <p className='text-sm text-ink-muted'>The charges behind this total are in finances, which owners and adults can open.</p>
      )}
    </div>
  )
}

function TaggedTransactions({ budget }: { budget: Budget }) {
  const untag = useMutation((transactionId: string) => api.request(tagTransaction, { params: { transactionId }, body: { tripId: null } }))

  return (
    <section className='flex flex-col gap-3'>
      <h3 className='text-base font-semibold'>Tagged to this trip</h3>
      <FormError>{untag.error}</FormError>

      {budget.transactions.length === 0 ? (
        <EmptyState title='No charges tagged yet'>Tag a charge below and it counts towards what this trip actually cost.</EmptyState>
      ) : (
        <ul className='flex flex-col rounded-card border border-line bg-surface'>
          {budget.transactions.map((transaction, index) => (
            <li key={transaction.id} className={index === 0 ? '' : 'border-t border-line'}>
              <div className='flex items-center gap-3 px-4 py-3'>
                <div className='min-w-0 flex-1'>
                  <p className='truncate font-medium'>{transaction.description}</p>
                  <p className='text-sm text-ink-muted'>
                    {formatCalendarDate(transaction.postedOn)}
                    {transaction.merchant ? ` · ${transaction.merchant}` : ''}
                  </p>
                </div>
                <p className={transaction.amountCents > 0 ? 'amount shrink-0 text-positive' : 'amount shrink-0'}>
                  {formatCents(transaction.amountCents)}
                </p>
                <button
                  type='button'
                  className='shrink-0 text-sm text-ink-muted underline underline-offset-4'
                  disabled={untag.pending}
                  onClick={() => {
                    untag.mutate(transaction.id)
                  }}
                >
                  Untag
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Everyday charges, so a trip expense can be found and tagged without leaving the page. */
function UntaggedTransactions({ tripId }: { tripId: string }) {
  const [transactions, setTransactions] = useState<TripTransaction[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .request(listTransactions, { query: { untagged: true, limit: 25 } })
      .then(({ transactions: found }) => {
        if (!cancelled) setTransactions(found)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(errorMessage(cause))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const tag = useMutation(async (transactionId: string) => {
    await api.request(tagTransaction, { params: { transactionId }, body: { tripId } })
    setTransactions(current => current?.filter(item => item.id !== transactionId) ?? null)
  })

  return (
    <section className='flex flex-col gap-3'>
      <h3 className='text-base font-semibold'>Recent charges</h3>
      <FormError>{loadError ?? tag.error}</FormError>

      {transactions === null ? (
        <p className='text-sm text-ink-muted'>Looking…</p>
      ) : transactions.length === 0 ? (
        <EmptyState title='Nothing untagged'>Every recent charge already belongs to a trip or to everyday spending.</EmptyState>
      ) : (
        <ul className='flex flex-col rounded-card border border-line bg-surface'>
          {transactions.map((transaction, index) => (
            <li key={transaction.id} className={index === 0 ? '' : 'border-t border-line'}>
              <div className='flex items-center gap-3 px-4 py-3'>
                <div className='min-w-0 flex-1'>
                  <p className='truncate font-medium'>{transaction.description}</p>
                  <p className='text-sm text-ink-muted'>
                    {formatCalendarDate(transaction.postedOn)}
                    {transaction.merchant ? ` · ${transaction.merchant}` : ''}
                  </p>
                </div>
                <p className='amount shrink-0'>{formatCents(transaction.amountCents)}</p>
                <Button
                  variant='outline'
                  disabled={tag.pending}
                  onClick={() => {
                    tag.mutate(transaction.id)
                  }}
                >
                  Tag
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
