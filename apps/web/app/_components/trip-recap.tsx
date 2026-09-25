import type { TripRecap as TripRecapValue } from '@ghar/contracts'
import { formatCents } from '@ghar/core/money'

// The look back once a trip is over: how long, who came, what got done, and what's left to settle.

const LINK = 'inline-flex min-h-tap items-center underline underline-offset-4'

export function TripRecap({ recap, canAddPhotos }: { recap: TripRecapValue; canAddPhotos: boolean }) {
  return (
    <section aria-labelledby='recap-heading' className='flex flex-col gap-2 rounded-card border border-line bg-surface p-4'>
      <h2 id='recap-heading' className='text-lg font-semibold'>
        How it went
      </h2>
      <p className='text-2xl font-semibold tracking-[-0.02em] tabular-nums'>{recap.lines.join(' · ')}</p>
      {recap.totalCents > 0 ? (
        <p className='text-sm text-ink-muted tabular-nums'>{formatCents(recap.totalCents, { currency: recap.currency })} spent together</p>
      ) : null}
      {recap.openTransfers > 0 || (recap.photos === 0 && canAddPhotos) ? (
        <div className='flex flex-wrap gap-x-4 text-sm'>
          {recap.openTransfers > 0 ? (
            <a href='#costs-heading' className={`${LINK} text-caution tabular-nums`}>
              {recap.openTransfers === 1 ? '1 payment left to settle' : `${String(recap.openTransfers)} payments left to settle`}
            </a>
          ) : null}
          {recap.photos === 0 && canAddPhotos ? (
            <a href='#photos-heading' className={LINK}>
              Add your photos
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
