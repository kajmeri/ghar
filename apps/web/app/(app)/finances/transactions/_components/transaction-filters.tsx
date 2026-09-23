'use client'

import type { Account, Category } from '@ghar/contracts'
import { X } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { SearchField } from '@/app/(app)/_components/ui/search-field'
import { NativeSelect } from '@/components/ui/native-select'
import { cn } from '@/lib/utils'

/**
 * What the list is narrowed to, kept in the URL so the page can be shared, reloaded and gone back
 * to. Every filter is part of the list's cursor, so changing one starts the list again from the
 * top, which is what the server does anyway.
 */
export function TransactionFilters({
  accounts,
  categories,
  filters,
  reviewCount,
  range,
}: {
  accounts: Account[]
  categories: Category[]
  filters: { q: string; account: string; category: string; review: boolean }
  reviewCount: number
  /** The dates the list is held to, already in words, or null when it covers everything. */
  range: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  function change(name: string, value: string) {
    const url = new URLSearchParams(params)
    if (value === '') url.delete(name)
    else url.set(name, value)
    go(url)
  }

  /** Both ends go together: half a range would narrow the list in a way nothing here can say. */
  function clearRange() {
    const url = new URLSearchParams(params)
    url.delete('from')
    url.delete('to')
    go(url)
  }

  function go(url: URLSearchParams) {
    const query = url.toString()
    startTransition(() => {
      router.replace(query === '' ? pathname : `${pathname}?${query}`, { scroll: false })
    })
  }

  return (
    <div className={cn('flex flex-col gap-3', pending && 'opacity-70')}>
      <SearchField label='Search charges' defaultValue={filters.q} placeholder='Merchant, description or note' />
      <div className='flex flex-wrap gap-3'>
        <NativeSelect
          aria-label='Account'
          className='min-w-40 flex-1'
          value={filters.account}
          onChange={event => {
            change('account', event.target.value)
          }}
        >
          <option value=''>All accounts</option>
          {accounts.map(account => (
            <option key={account.id} value={account.id}>
              {account.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label='Category'
          className='min-w-40 flex-1'
          value={filters.category}
          onChange={event => {
            change('category', event.target.value)
          }}
        >
          <option value=''>All categories</option>
          <option value='none'>Not filed yet</option>
          {categories.map(category => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </NativeSelect>
        <button
          type='button'
          aria-pressed={filters.review}
          onClick={() => {
            change('review', filters.review ? '' : '1')
          }}
          className={cn(
            'inline-flex h-tap min-w-40 flex-1 items-center justify-center rounded-control border px-4 text-base transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden',
            filters.review ? 'border-ink bg-ink text-paper' : 'border-input bg-surface text-ink hover:bg-paper'
          )}
        >
          {reviewCount > 0 ? `To review (${String(reviewCount)})` : 'To review'}
        </button>
      </div>
      {range === null ? null : (
        <div className='flex flex-wrap items-center gap-2 text-sm'>
          <span className='text-ink-muted'>Showing {range}</span>
          <button
            type='button'
            onClick={clearRange}
            className='inline-flex h-tap items-center gap-1 rounded-pill border border-line px-4 transition-colors hover:bg-paper focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'
          >
            <X aria-hidden className='size-4' />
            Show every date
          </button>
        </div>
      )}
    </div>
  )
}
