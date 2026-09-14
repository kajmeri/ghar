import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface DataListColumn<Row> {
  id: string;
  header: string;
  cell: (row: Row) => ReactNode;
  align?: 'start' | 'end';
  /** Leave the column out of the table below this breakpoint. */
  showFrom?: 'md' | 'lg';
  /** false leaves it out of the stacked rows on phones, where room is tight. */
  stacked?: boolean;
}

export interface DataListProps<Row> {
  /** Names the list for screen readers: the table's caption. */
  label: string;
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  primary: { header: string; cell: (row: Row) => ReactNode };
  secondary?: (row: Row) => ReactNode;
  /** An Avatar or IconAvatar. */
  leading?: (row: Row) => ReactNode;
  columns?: DataListColumn<Row>[];
  /** The figure a row is about, usually an amount. Right-aligned, and top-right on phones. */
  trailing?: { header: string; cell: (row: Row) => ReactNode };
  /**
   * Makes the whole row a link. The primary cell holds the anchor and stretches it over the row,
   * so a cell with its own button needs `relative z-10` to stay clickable.
   */
  href?: (row: Row) => string | undefined;
  /** Shown instead of the list when there are no rows. */
  empty?: ReactNode;
  className?: string;
}

const HEADER_CELL = 'px-4 py-3 text-sm font-medium text-ink-muted';
const SHOW_FROM = { md: '', lg: 'hidden lg:table-cell' } as const;
const ROW_LINK =
  'after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-[inherit] focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50 focus-visible:after:ring-inset';

/**
 * Tabular data that works on a phone. A real table from md up; below md the same rows stack,
 * with the extra columns as label and value pairs. Never scrolls sideways.
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
  empty,
  className,
}: DataListProps<Row>) {
  if (rows.length === 0 && empty) return empty;

  const stackedColumns = columns.filter((column) => column.stacked !== false);

  function primaryContent(row: Row) {
    const link = href?.(row);
    return link ? (
      <Link href={link} className={ROW_LINK}>
        {primary.cell(row)}
      </Link>
    ) : (
      primary.cell(row)
    );
  }

  return (
    <div className={cn('overflow-hidden rounded-card border border-line bg-surface', className)}>
      <table className="hidden w-full border-collapse text-left md:table">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={HEADER_CELL}>
              {primary.header}
            </th>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className={cn(
                  HEADER_CELL,
                  column.align === 'end' && 'text-right',
                  SHOW_FROM[column.showFrom ?? 'md'],
                )}
              >
                {column.header}
              </th>
            ))}
            {trailing ? (
              <th scope="col" className={cn(HEADER_CELL, 'text-right')}>
                {trailing.header}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={cn(href?.(row) && 'relative transition-colors hover:bg-paper')}
            >
              <th scope="row" className="px-4 py-3 text-left font-normal">
                <div className="flex items-center gap-3">
                  {leading?.(row)}
                  <div className="min-w-0">
                    <p className="font-medium break-words">{primaryContent(row)}</p>
                    {secondary ? (
                      <p className="text-sm break-words text-ink-muted">{secondary(row)}</p>
                    ) : null}
                  </div>
                </div>
              </th>
              {columns.map((column) => (
                <td
                  key={column.id}
                  className={cn(
                    'px-4 py-3 text-base',
                    column.align === 'end' && 'text-right',
                    SHOW_FROM[column.showFrom ?? 'md'],
                  )}
                >
                  {column.cell(row)}
                </td>
              ))}
              {trailing ? (
                <td className="px-4 py-3 text-right text-base font-medium whitespace-nowrap">
                  {trailing.cell(row)}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>

      <ul aria-label={label} className="divide-y divide-line md:hidden">
        {rows.map((row) => (
          <li
            key={rowKey(row)}
            className={cn('relative px-4 py-3', href?.(row) && 'transition-colors hover:bg-paper')}
          >
            <div className="flex items-start gap-3">
              {leading?.(row)}
              <div className="min-w-0 flex-1">
                <div className="flex min-h-6 items-baseline justify-between gap-3">
                  <p className="min-w-0 font-medium break-words">{primaryContent(row)}</p>
                  {trailing ? (
                    <p className="shrink-0 text-right font-medium">
                      <span className="sr-only">{trailing.header}: </span>
                      {trailing.cell(row)}
                    </p>
                  ) : null}
                </div>
                {secondary ? (
                  <p className="text-sm break-words text-ink-muted">{secondary(row)}</p>
                ) : null}
                {stackedColumns.length > 0 ? (
                  <dl className="mt-2 flex flex-col gap-1 text-sm">
                    {stackedColumns.map((column) => (
                      <Fragment key={column.id}>
                        <div className="flex justify-between gap-4">
                          <dt className="text-ink-muted">{column.header}</dt>
                          <dd className="min-w-0 text-right break-words">{column.cell(row)}</dd>
                        </div>
                      </Fragment>
                    ))}
                  </dl>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
