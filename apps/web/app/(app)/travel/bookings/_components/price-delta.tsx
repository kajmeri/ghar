import { formatCents } from '@ghar/core/money'

/** The latest price against what was paid. Cheaper is good news, so it's positive. */
export function PriceDelta({ deltaCents, currency }: { deltaCents: number | null; currency: string }) {
  if (deltaCents === null) {
    return (
      <span className='font-normal text-ink-muted'>
        <span aria-hidden>—</span>
        <span className='sr-only'>No price yet</span>
      </span>
    )
  }
  if (deltaCents === 0) return <span className='font-normal text-ink-muted'>No change</span>
  const amount = formatCents(Math.abs(deltaCents), { currency })
  return deltaCents < 0 ? <span className='text-positive'>{amount} cheaper</span> : <span className='text-negative'>{amount} more</span>
}
