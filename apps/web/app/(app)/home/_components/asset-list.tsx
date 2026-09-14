'use client'

import type { AssetListItem } from '@ghar/contracts'
import type { CalendarDate } from '@ghar/core/dates'
import { searchAssets } from '@ghar/core/home'
import { useState } from 'react'
import { IconAvatar } from '@/app/(app)/_components/ui/avatar'
import { DataList } from '@/app/(app)/_components/ui/data-list'
import { SearchField } from '@/app/(app)/_components/ui/search-field'
import { Pill } from '@/components/ui/pill'
import { dueText, makeAndModel, MAINTENANCE_TONES } from '@/lib/home/display'
import { ASSET_ICONS } from './asset-icon'

/** The things in the house, searchable by name, model, serial number or where it is. */
export function AssetList({ assets, today }: { assets: AssetListItem[]; today: CalendarDate }) {
  const [query, setQuery] = useState('')
  const shown = query.trim() === '' ? assets : searchAssets(assets, query)

  return (
    <div className='flex flex-col gap-3'>
      <SearchField label='Search things' value={query} onChange={setQuery} placeholder='Name, model or serial number' />
      <DataList
        label='Things'
        rows={shown}
        rowKey={asset => asset.id}
        href={asset => `/home/assets/${asset.id}`}
        leading={asset => <IconAvatar icon={ASSET_ICONS[asset.kind]} />}
        primary={{ header: 'Name', cell: asset => asset.name }}
        secondary={asset => [makeAndModel(asset), asset.location].filter(Boolean).join(' · ')}
        columns={[
          {
            id: 'next',
            header: 'Next job',
            stacked: false,
            cell: asset =>
              asset.nextTask ? (
                <span>
                  {asset.nextTask.title}
                  <span className='block text-sm text-ink-muted'>{dueText(asset.nextTask.nextDueOn, today)}</span>
                </span>
              ) : (
                <span className='text-ink-muted'>None</span>
              ),
          },
          {
            id: 'documents',
            header: 'Documents',
            align: 'end',
            showFrom: 'lg',
            stacked: false,
            cell: asset => <span className='tabular-nums'>{asset.documentCount}</span>,
          },
        ]}
        trailing={{
          header: 'Due',
          cell: asset => {
            const task = asset.nextTask
            if (!task || (task.state !== 'overdue' && task.state !== 'due_soon')) return null
            return <Pill tone={MAINTENANCE_TONES[task.state]}>{dueText(task.nextDueOn, today)}</Pill>
          },
        }}
        empty={
          <p className='rounded-card border border-line bg-surface p-4 text-ink-muted'>
            Nothing matches “{query.trim()}”. Try the name, the model or a serial number.
          </p>
        }
      />
    </div>
  )
}
