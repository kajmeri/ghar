import type { NetWorthChartValue } from '@ghar/contracts'
import { daysBetween, formatCalendarDate } from '@ghar/core/dates'
import { formatCents } from '@ghar/core/money'
import type { ReactNode } from 'react'
import type { NetWorthView } from '@/lib/networth/display'
import { cn } from '@/lib/utils'

type Point = NetWorthChartValue['points'][number]
type Tone = 'measured' | 'manual' | 'stale'

const GRANULARITY_NAMES = { day: 'day', week: 'week', month: 'month' } as const

/**
 * Net worth over time, drawn from the arrays @ghar/core/finances shaped: nothing here computes a
 * figure, a domain or a tick. The lines stretch to any width; labels are HTML so they keep their
 * size. A stretch where a balance was carried forward is shaded and dashed, so a flat line reads as
 * "we don't know" instead of "nothing changed". A screen reader gets the same readings as a table.
 */
export function NetWorthChart({ chart, view, currency }: { chart: NetWorthChartValue; view: NetWorthView; currency: string }) {
  const first = chart.points[0]
  const last = chart.points.at(-1)
  if (!first || !last) return null

  const domain = view === 'net' ? chart.netDomain : chart.splitDomain
  const spanDays = Math.max(daysBetween(first.asOf, last.asOf), 1)
  const spanCents = domain.maxCents - domain.minCents || 1
  const x = (date: string) => Math.min(Math.max((daysBetween(first.asOf, date) / spanDays) * 100, 0), 100)
  const y = (cents: number) => ((domain.maxCents - cents) / spanCents) * 100
  const money = (cents: number) => formatCents(cents, { currency })

  const typedIn = chart.points.filter(point => point.manual)
  const trackingMark =
    chart.trackingStartedOn !== null && chart.historyStartsOn !== null && chart.historyStartsOn < chart.trackingStartedOn && chart.trackingStartedOn > first.asOf
      ? chart.trackingStartedOn
      : null

  return (
    <figure className='flex flex-col gap-3'>
      <div className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-2'>
        <div className='relative h-56 w-12 md:h-72' aria-hidden>
          {domain.ticks.map(tick => (
            // The bottom label sits above its line, so it never runs into the dates below the plot.
            <span
              key={tick}
              className={cn('absolute right-0 text-xs text-ink-muted tabular-nums', y(tick) > 90 ? '-translate-y-full' : '-translate-y-1/2')}
              style={{ top: `${y(tick)}%` }}
            >
              {formatCents(tick, { currency, notation: 'compact' })}
            </span>
          ))}
        </div>

        <div className='relative h-56 md:h-72' aria-hidden>
          <svg viewBox='0 0 100 100' preserveAspectRatio='none' className='absolute inset-0 size-full overflow-visible'>
            {chart.staleRanges.map(range => {
              const from = x(range.fromOn)
              return (
                <rect
                  key={range.fromOn}
                  x={from}
                  y='0'
                  width={Math.max(x(range.toOn) - from, 0.8)}
                  height='100'
                  className='fill-caution/15'
                />
              )
            })}
            {domain.ticks.map(tick => (
              <line
                key={tick}
                x1='0'
                x2='100'
                y1={y(tick)}
                y2={y(tick)}
                strokeWidth='1'
                vectorEffect='non-scaling-stroke'
                className={tick === 0 ? 'stroke-line-strong' : 'stroke-line'}
              />
            ))}
            {trackingMark ? (
              <line
                x1={x(trackingMark)}
                x2={x(trackingMark)}
                y1='0'
                y2='100'
                strokeWidth='1'
                strokeDasharray='3 3'
                vectorEffect='non-scaling-stroke'
                className='stroke-ink-muted'
              />
            ) : null}

            {view === 'net' ? (
              <>
                <Area points={chart.points} x={x} y={y} pick={point => point.assetsCents} className='fill-ink/8' />
                <Area points={chart.points} x={x} y={y} pick={point => point.liabilitiesCents} className='fill-negative/15' />
                <Line points={chart.points} x={x} y={y} pick={point => point.netCents} strong />
              </>
            ) : (
              <>
                <Area points={chart.points} x={x} y={y} pick={point => point.assetsCents} className='fill-ink/8' />
                <Area points={chart.points} x={x} y={y} pick={point => point.owedCents} className='fill-negative/10' />
                <Line points={chart.points} x={x} y={y} pick={point => point.assetsCents} strong />
                <Line points={chart.points} x={x} y={y} pick={point => point.owedCents} color='negative' />
              </>
            )}
          </svg>

          {typedIn.length <= 60
            ? typedIn.map(point => (
                <span
                  key={point.asOf}
                  className='absolute size-2 -translate-1/2 rounded-pill border border-ink bg-surface'
                  style={{ left: `${x(point.asOf)}%`, top: `${y(view === 'net' ? point.netCents : point.assetsCents)}%` }}
                />
              ))
            : null}
          {trackingMark ? (
            <span
              className={cn(
                'absolute top-0 px-1 text-xs whitespace-nowrap text-ink-muted',
                x(trackingMark) > 60 ? '-translate-x-full' : ''
              )}
              style={{ left: `${x(trackingMark)}%` }}
            >
              Tracking on
            </span>
          ) : null}
        </div>

        <span aria-hidden />
        <div className='relative mt-1 h-5' aria-hidden>
          {chart.xTicks.map(tick => {
            const at = x(tick)
            return (
              <span
                key={tick}
                className={cn('absolute text-xs whitespace-nowrap text-ink-muted tabular-nums', at > 88 ? '-translate-x-full' : '-translate-x-1/2')}
                style={{ left: `${at}%` }}
              >
                {formatCalendarDate(tick, spanDays > 400 ? 'MMM yyyy' : 'MMM d')}
              </span>
            )
          })}
        </div>
      </div>

      <figcaption className='flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted'>
        {view === 'net' ? (
          <>
            <LegendItem swatch={<span className='w-4 border-t-2 border-ink' />}>Net worth</LegendItem>
            <LegendItem swatch={<span className='size-3 rounded-[2px] bg-ink/8 inset-ring inset-ring-line' />}>Owned</LegendItem>
            <LegendItem swatch={<span className='size-3 rounded-[2px] bg-negative/15' />}>Owed</LegendItem>
          </>
        ) : (
          <>
            <LegendItem swatch={<span className='w-4 border-t-2 border-ink' />}>Owned</LegendItem>
            <LegendItem swatch={<span className='w-4 border-t-2 border-negative' />}>Owed</LegendItem>
          </>
        )}
        {chart.staleRanges.length > 0 ? (
          <LegendItem swatch={<span className='w-4 border-t-2 border-dashed border-caution-ink' />}>Balance carried forward</LegendItem>
        ) : null}
        {typedIn.length > 0 ? (
          <LegendItem swatch={<span className='size-2 rounded-pill border border-ink bg-surface' />}>Typed in from old records</LegendItem>
        ) : null}
      </figcaption>

      <table className='sr-only'>
        <caption>Net worth, one reading a {GRANULARITY_NAMES[chart.granularity]}</caption>
        <thead>
          <tr>
            <th scope='col'>Date</th>
            <th scope='col'>Net worth</th>
            <th scope='col'>Owned</th>
            <th scope='col'>Owed</th>
            <th scope='col'>Note</th>
          </tr>
        </thead>
        <tbody>
          {chart.points.map(point => (
            <tr key={point.asOf}>
              <td>{formatCalendarDate(point.asOf)}</td>
              <td>{money(point.netCents)}</td>
              <td>{money(point.assetsCents)}</td>
              <td>{money(point.owedCents)}</td>
              <td>{[point.stale ? 'a balance was carried forward' : null, point.manual ? 'typed in' : null].filter(Boolean).join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

interface SeriesProps {
  points: readonly Point[]
  x: (date: string) => number
  y: (cents: number) => number
  pick: (point: Point) => number
}

/** Filled between the value and zero. Behind the lines, so it only gives the line its context. */
function Area({ points, x, y, pick, className }: SeriesProps & { className: string }) {
  const first = points[0]
  const last = points.at(-1)
  if (!first || !last) return null
  const edge = points.map(point => `${x(point.asOf)},${y(pick(point))}`).join(' ')
  return <polygon points={`${x(first.asOf)},${y(0)} ${edge} ${x(last.asOf)},${y(0)}`} className={className} />
}

/**
 * A line in runs. A step touching a carried-forward reading is dashed in caution: the value there is
 * the last one known, and where the real change happened inside the gap is unknown. A step between
 * typed-in readings is lighter, since those are one person's figures from old statements.
 */
function Line({ points, x, y, pick, strong = false, color = 'ink' }: SeriesProps & { strong?: boolean; color?: 'ink' | 'negative' }) {
  const runs: { tone: Tone; points: Point[] }[] = []
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]
    const to = points[index]
    if (!from || !to) continue
    const tone: Tone = from.stale || to.stale ? 'stale' : from.manual && to.manual ? 'manual' : 'measured'
    const open = runs.at(-1)
    if (open?.tone === tone) open.points.push(to)
    else runs.push({ tone, points: [from, to] })
  }

  const measured = color === 'negative' ? 'stroke-negative' : 'stroke-ink'
  return runs.map(run => (
    <polyline
      key={`${run.tone}:${run.points[0]?.asOf ?? ''}`}
      points={run.points.map(point => `${x(point.asOf)},${y(pick(point))}`).join(' ')}
      fill='none'
      strokeWidth={strong ? 2.5 : 2}
      strokeLinejoin='round'
      strokeLinecap='round'
      strokeDasharray={run.tone === 'stale' ? '5 4' : undefined}
      vectorEffect='non-scaling-stroke'
      className={run.tone === 'stale' ? 'stroke-caution-ink' : run.tone === 'manual' ? 'stroke-ink-muted' : measured}
    />
  ))
}

function LegendItem({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <span className='inline-flex items-center gap-2'>
      <span aria-hidden className='flex w-4 justify-center'>
        {swatch}
      </span>
      {children}
    </span>
  )
}
