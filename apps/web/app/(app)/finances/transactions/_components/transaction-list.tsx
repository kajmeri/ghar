'use client'

import { listTransactions, type Category, type Transaction } from '@ghar/contracts'
import { formatCalendarDate } from '@ghar/core/dates'
import { formatCents } from '@ghar/core/money'
import { useState } from 'react'
import { DataList } from '@/app/(app)/_components/ui/data-list'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { Pill } from '@/components/ui/pill'
import { api, errorMessage } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { TransactionSheet } from './transaction-sheet'

const PAGE_SIZE = 50

export interface TransactionPage {
  items: Transaction[]
  nextCursor: string | null
}

/**
 * The household's charges, newest first. The server sends the first page with the filters already
 * applied; later pages come from the same endpoint a phone would call, so the two clients page the
 * list the same way. Tapping a row opens what a person can change about it.
 *
 * The page keys this on the filters, so changing one starts the list again from the server's first
 * page instead of appending to a list that was answering a different question.
 */
export function TransactionList({
  page,
  filters,
  categories,
  currency,
  canManage,
}: {
  page: TransactionPage
  filters: { q: string; account: string; category: string; review: boolean }
  categories: Category[]
  currency: string
  canManage: boolean
}) {
  const [items, setItems] = useState(page.items)
  const [cursor, setCursor] = useState(page.nextCursor)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  // `turn` mounts a fresh sheet on each open, and the id is kept while the sheet slides away so it
  // still has a charge to show.
  const [open, setOpen] = useState<{ id: string; turn: number; visible: boolean } | null>(null)

  async function showMore() {
    if (cursor === null) return
    setLoading(true)
    setLoadError(null)
    try {
      const next = await api.request(listTransactions, {
        query: {
          cursor,
          limit: PAGE_SIZE,
          q: filters.q === '' ? undefined : filters.q,
          accountId: filters.account === '' ? undefined : filters.account,
          categoryId: filters.category === '' ? undefined : filters.category,
          review: filters.review ? true : undefined,
        },
      })
      setItems(current => [...current, ...next.items])
      setCursor(next.nextCursor)
    } catch (cause) {
      setLoadError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  const opened = open === null ? null : (items.find(item => item.id === open.id) ?? null)

  return (
    <div className='flex flex-col gap-3'>
      <DataList
        label='Charges'
        rows={items}
        rowKey={transaction => transaction.id}
        onSelect={transaction => {
          setOpen(current => ({ id: transaction.id, turn: (current?.turn ?? 0) + 1, visible: true }))
        }}
        selectPopup='dialog'
        primary={{ header: 'Charge', cell: transaction => transaction.merchant ?? transaction.description }}
        secondary={transaction =>
          [formatCalendarDate(transaction.postedOn), transaction.accountLabel ?? 'By hand', transaction.isPending ? 'Pending' : null]
            .filter(Boolean)
            .join(' · ')
        }
        columns={[
          {
            id: 'category',
            header: 'Category',
            cell: transaction =>
              transaction.categoryName ? (
                transaction.categoryName
              ) : transaction.needsReview ? (
                <Pill tone='caution'>To review</Pill>
              ) : (
                <span className='text-ink-muted'>Not filed</span>
              ),
          },
          {
            id: 'note',
            header: 'Note',
            showFrom: 'lg',
            stacked: false,
            cell: transaction => transaction.notes ?? <span className='text-ink-muted'>—</span>,
          },
        ]}
        trailing={{
          header: 'Amount',
          cell: transaction => (
            <span className={cn('amount', transaction.amountCents > 0 && 'text-positive', transaction.isExcluded && 'text-ink-muted')}>
              {formatCents(transaction.amountCents, { currency })}
              {transaction.isExcluded ? <span className='sr-only'> (left out of spending)</span> : null}
            </span>
          ),
        }}
        empty={
          <p className='rounded-card border border-line bg-surface px-4 py-6 text-center text-ink-muted'>
            Nothing matches these filters. Try a different account, category or search.
          </p>
        }
      />

      <FormError>{loadError}</FormError>

      {cursor === null ? null : (
        <div className='flex justify-center'>
          <Button variant='outline' disabled={loading} onClick={() => void showMore()}>
            {loading ? 'Loading…' : 'Show more'}
          </Button>
        </div>
      )}

      {open === null || opened === null ? null : (
        <TransactionSheet
          key={open.turn}
          transaction={opened}
          categories={categories}
          currency={currency}
          canManage={canManage}
          open={open.visible}
          onClose={() => {
            setOpen(current => (current === null ? null : { ...current, visible: false }))
          }}
          onSaved={saved => {
            setItems(current => current.map(item => (item.id === saved.id ? saved : item)))
          }}
        />
      )}
    </div>
  )
}
