import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/*
 * Placeholders in the exact shape of the components they stand in for, so nothing jumps when the
 * page arrives. Each text bone fills its line's height and draws a bar at roughly cap height.
 * Still, no shimmer: motion only answers a user action.
 */

type TextSize = 'sm' | 'base' | 'lg'

const LINE_BOX: Record<TextSize, string> = { sm: 'h-5', base: 'h-6', lg: 'h-7' }
const BAR: Record<TextSize, string> = { sm: 'h-2.5', base: 'h-3', lg: 'h-3.5' }
const WIDTHS = ['w-40', 'w-28', 'w-36', 'w-24'] as const

function TextBone({
  size = 'base',
  width,
  muted = false,
  className,
}: {
  size?: TextSize
  width: string
  muted?: boolean
  className?: string
}) {
  return (
    <span className={cn('flex items-center', LINE_BOX[size], className)}>
      <span className={cn('max-w-full rounded-pill', BAR[size], width, muted ? 'bg-line/60' : 'bg-line')} />
    </span>
  )
}

/** Wrap a loading.tsx's skeletons in this, once: it tells screen readers what's happening. */
export function LoadingRegion({ label = 'Loading…', children }: { label?: string; children: ReactNode }) {
  return (
    <div aria-busy='true'>
      <p role='status' className='sr-only'>
        {label}
      </p>
      <div aria-hidden>{children}</div>
    </div>
  )
}

export function PageHeaderSkeleton({ description = true, action = false }: { description?: boolean; action?: boolean }) {
  return (
    <div className='flex flex-col gap-4 pb-6 md:flex-row md:items-end md:justify-between md:pb-8'>
      <div className='min-w-0'>
        <span className='flex h-8 items-center md:h-9'>
          <span className='h-5 w-40 rounded-pill bg-line md:h-6 md:w-48' />
        </span>
        {description ? <TextBone width='w-64' muted className='mt-1' /> : null}
      </div>
      {action ? <span className='h-tap w-full rounded-control bg-line/60 md:w-36' /> : null}
    </div>
  )
}

export function SectionHeaderSkeleton({ description = false }: { description?: boolean }) {
  return (
    <div className='pb-3'>
      <TextBone size='lg' width='w-32' />
      {description ? <TextBone size='sm' width='w-56' muted /> : null}
    </div>
  )
}

export function StatCardSkeleton({ delta = true }: { delta?: boolean }) {
  return (
    <div className='@container rounded-card border border-line bg-surface p-4 md:p-5'>
      <div className='flex flex-col gap-1'>
        <TextBone size='sm' width='w-20' muted />
        <span className='flex h-9 items-center'>
          <span className='h-6 w-28 max-w-full rounded-pill bg-line @min-[12rem]:w-36' />
        </span>
        {delta ? <TextBone size='sm' width='w-24' muted /> : null}
      </div>
    </div>
  )
}

/** Mirrors StatGroup's layout. */
export function StatGroupSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className='@container'>
      <div className='grid grid-cols-1 gap-3 @xs:grid-cols-2 @4xl:auto-cols-fr @4xl:grid-flow-col @4xl:grid-cols-none'>
        {Array.from({ length: count }, (_, index) => (
          <StatCardSkeleton key={index} />
        ))}
      </div>
    </div>
  )
}

/** Mirrors DataList: a table from md up, stacked rows below. */
export function DataListSkeleton({
  rows = 4,
  leading = false,
  secondary = true,
  columns = 0,
  trailing = true,
}: {
  rows?: number
  leading?: boolean
  secondary?: boolean
  columns?: number
  trailing?: boolean
}) {
  const rowIndexes = Array.from({ length: rows }, (_, index) => index)
  const columnIndexes = Array.from({ length: columns }, (_, index) => index)
  const avatar = leading ? <span className='size-10 shrink-0 rounded-pill bg-line/60' /> : null

  return (
    <div className='overflow-hidden rounded-card border border-line bg-surface'>
      <table className='hidden w-full border-collapse md:table'>
        <thead>
          <tr className='border-b border-line'>
            <th className='px-4 py-3'>
              <TextBone size='sm' width='w-20' muted />
            </th>
            {columnIndexes.map(column => (
              <th key={column} className='px-4 py-3'>
                <TextBone size='sm' width='w-16' muted />
              </th>
            ))}
            {trailing ? (
              <th className='px-4 py-3'>
                <TextBone size='sm' width='w-16' muted className='justify-end' />
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className='divide-y divide-line'>
          {rowIndexes.map(row => (
            <tr key={row}>
              <td className='px-4 py-3'>
                <div className='flex items-center gap-3'>
                  {avatar}
                  <div className='min-w-0'>
                    <TextBone width={WIDTHS[row % WIDTHS.length] ?? 'w-32'} />
                    {secondary ? <TextBone size='sm' width='w-24' muted /> : null}
                  </div>
                </div>
              </td>
              {columnIndexes.map(column => (
                <td key={column} className='px-4 py-3'>
                  <TextBone width='w-20' muted />
                </td>
              ))}
              {trailing ? (
                <td className='px-4 py-3'>
                  <TextBone width='w-20' className='justify-end' />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>

      <ul className='divide-y divide-line md:hidden'>
        {rowIndexes.map(row => (
          <li key={row} className='px-4 py-3'>
            <div className='flex items-start gap-3'>
              {avatar}
              <div className='min-w-0 flex-1'>
                <div className='flex justify-between gap-3'>
                  <TextBone width={WIDTHS[row % WIDTHS.length] ?? 'w-32'} />
                  {trailing ? <TextBone width='w-16' /> : null}
                </div>
                {secondary ? <TextBone size='sm' width='w-24' muted /> : null}
                {columns > 0 ? (
                  <div className='mt-2 flex flex-col gap-1'>
                    {columnIndexes.map(column => (
                      <div key={column} className='flex justify-between gap-4'>
                        <TextBone size='sm' width='w-16' muted />
                        <TextBone size='sm' width='w-20' muted />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Mirrors EmptyState, including the illustration's footprint and the action button. */
export function EmptyStateSkeleton({ action = true }: { action?: boolean }) {
  return (
    <div className='flex flex-col items-center rounded-card border border-line bg-surface px-6 py-10 md:px-10 md:py-14'>
      <div className='mb-5 flex h-24 w-30 items-end justify-center'>
        <span className='h-2 w-20 rounded-pill bg-line/60' />
      </div>
      <TextBone size='lg' width='w-48' />
      <div className='mt-1 flex w-full max-w-md flex-col items-center'>
        <TextBone width='w-full' muted className='w-full max-w-80' />
        <TextBone width='w-full' muted className='w-full max-w-56' />
      </div>
      {action ? <span className='mt-6 h-tap w-full rounded-control bg-line/60 sm:w-48' /> : null}
    </div>
  )
}

/** Mirrors ProgressBar: label and figures, the empty track itself, and the detail line. */
export function ProgressBarSkeleton({ detail = true }: { detail?: boolean }) {
  return (
    <div className='flex flex-col gap-2'>
      <div className='flex justify-between gap-3'>
        <TextBone width='w-28' />
        <TextBone size='sm' width='w-24' muted />
      </div>
      <div className='h-2 rounded-pill bg-line' />
      {detail ? <TextBone size='sm' width='w-20' muted /> : null}
    </div>
  )
}

/** A card of text lines, for settings-style cards. */
export function CardSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className='flex flex-col rounded-card border border-line bg-surface p-4'>
      <TextBone width='w-40' />
      {Array.from({ length: lines - 1 }, (_, index) => (
        <TextBone key={index} size='sm' width={WIDTHS[(index + 1) % WIDTHS.length] ?? 'w-32'} muted />
      ))}
    </div>
  )
}
