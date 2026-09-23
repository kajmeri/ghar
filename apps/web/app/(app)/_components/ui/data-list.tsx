import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface DataListColumn<Row> {
  id: string
  header: string
  cell: (row: Row) => ReactNode
  align?: 'start' | 'end'
  /** Leave the column out of the table below this breakpoint. */
  showFrom?: 'md' | 'lg'
  /** false leaves it out of the stacked rows on phones, where room is tight. */
  stacked?: boolean
}

export interface DataListProps<Row> {
  /** Names the list for screen readers: the table's caption. */
  label: string
  rows: readonly Row[]
  rowKey: (row: Row) => string
  primary: { header: string; cell: (row: Row) => ReactNode }
  secondary?: (row: Row) => ReactNode
  /** An Avatar or IconAvatar. */
  leading?: (row: Row) => ReactNode
  columns?: DataListColumn<Row>[]
  /** The figure a row is about, usually an amount. Right-aligned, and top-right on phones. */
  trailing?: { header: string; cell: (row: Row) => ReactNode }
  /**
   * Makes the whole row a link. The primary cell holds the anchor and stretches it over the row,
   * so a cell with its own button needs `relative z-10` to stay clickable.
   */
  href?: (row: Row) => string | undefined
  /**
   * Makes the whole row a button, for a row that opens something instead of going somewhere. It
   * stretches over the row exactly as `href` does, and the two are not used together.
   */
  onSelect?: (row: Row) => void
  /** What the row's button says it opens, for screen readers: `dialog` for a sheet. */
  selectPopup?: 'dialog' | 'menu'
  /** Shown instead of the list when there are no rows. */
  empty?: ReactNode
  className?: string
}

const HEADER_CELL = 'px-4 py-3 text-sm font-medium text-ink-muted'
const SHOW_FROM = { md: '', lg: 'hidden lg:table-cell' } as const
/** Columns left out of the stacked rows only appear once the table does. */
const UNSTACKED = { md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' } as const
const ROW_LINK =
  'after:absolute after:inset-0 focus-visible:outline-hidden focus-visible:after:rounded-[inherit] focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset'

/**
 * Tabular data that works on a phone. A real table from md up; below md the same rows stack, with
 * the extra columns as label and value pairs. Never scrolls sideways.
 *
 * The rows are rendered once and restyled at md, not drawn twice and hidden by breakpoint, so a
 * long list costs half the HTML. The table elements change display below md, and some browsers
 * drop a table's semantics when that happens, so each one states its role.
 */
export function DataList<Row>({
  label,
  rows,
  rowKey,
  primary,
  secondary,
  leading,
  columns = [],
  trailing,
  href,
  onSelect,
  selectPopup,
  empty,
  className,
}: DataListProps<Row>) {
  if (rows.length === 0 && empty) return empty

  const firstStacked = columns.findIndex(column => column.stacked !== false)

  return (
    <div className={cn('overflow-hidden rounded-card border border-line bg-surface', className)}>
      <table role='table' className='w-full border-collapse text-left max-md:block'>
        <caption className='sr-only'>{label}</caption>
        <thead role='rowgroup' className='max-md:hidden'>
          <tr role='row' className='border-b border-line'>
            <th role='columnheader' scope='col' className={HEADER_CELL}>
              {primary.header}
            </th>
            {columns.map(column => (
              <th
                key={column.id}
                role='columnheader'
                scope='col'
                className={cn(HEADER_CELL, column.align === 'end' && 'text-right', SHOW_FROM[column.showFrom ?? 'md'])}
              >
                {column.header}
              </th>
            ))}
            {trailing ? (
              <th role='columnheader' scope='col' className={cn(HEADER_CELL, 'text-right')}>
                {trailing.header}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody role='rowgroup' className='divide-y divide-line max-md:block'>
          {rows.map(row => {
            const link = href?.(row)
            return (
              <tr
                key={rowKey(row)}
                role='row'
                className={cn('relative max-md:block max-md:px-4 max-md:py-3', (link || onSelect) && 'transition-colors hover:bg-paper')}
              >
                <th role='rowheader' scope='row' className='text-left font-normal max-md:block md:px-4 md:py-3'>
                  <div className='flex items-start gap-3 md:items-center'>
                    {leading?.(row)}
                    <div className='min-w-0 flex-1'>
                      <div className='flex min-h-6 items-baseline justify-between gap-3'>
                        <p className='min-w-0 font-medium break-words'>
                          {link ? (
                            <Link href={link} className={ROW_LINK}>
                              {primary.cell(row)}
                            </Link>
                          ) : onSelect ? (
                            <button
                              type='button'
                              aria-haspopup={selectPopup}
                              className={cn(ROW_LINK, 'text-left')}
                              onClick={() => {
                                onSelect(row)
                              }}
                            >
                              {primary.cell(row)}
                            </button>
                          ) : (
                            primary.cell(row)
                          )}
                        </p>
                        {trailing ? (
                          // Phones show the figure beside the name; from md it has its own column.
                          <p className='shrink-0 text-right font-medium md:hidden'>
                            <span className='sr-only'>{trailing.header}: </span>
                            {trailing.cell(row)}
                          </p>
                        ) : null}
                      </div>
                      {secondary ? <p className='text-sm break-words text-ink-muted'>{secondary(row)}</p> : null}
                    </div>
                  </div>
                </th>
                {columns.map((column, index) => {
                  if (column.stacked === false) {
                    return (
                      <td
                        key={column.id}
                        role='cell'
                        className={cn('px-4 py-3 text-base', column.align === 'end' && 'text-right', UNSTACKED[column.showFrom ?? 'md'])}
                      >
                        {column.cell(row)}
                      </td>
                    )
                  }
                  return (
                    <td
                      key={column.id}
                      role='cell'
                      className={cn(
                        'text-base max-md:flex max-md:justify-between max-md:gap-4 max-md:text-sm md:px-4 md:py-3',
                        index === firstStacked ? 'max-md:mt-2' : 'max-md:mt-1',
                        // Lines the label and value pairs up under the name, past the avatar.
                        leading && 'max-md:ml-13',
                        column.align === 'end' && 'md:text-right',
                        column.showFrom === 'lg' && 'md:hidden lg:table-cell'
                      )}
                    >
                      <span className='text-ink-muted md:hidden'>{column.header}</span>
                      <span className='max-md:min-w-0 max-md:text-right max-md:break-words'>{column.cell(row)}</span>
                    </td>
                  )
                })}
                {trailing ? (
                  <td role='cell' className='px-4 py-3 text-right text-base font-medium whitespace-nowrap max-md:hidden'>
                    {trailing.cell(row)}
                  </td>
                ) : null}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
