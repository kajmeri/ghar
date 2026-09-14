import type { ItineraryWarningValue } from '@ghar/contracts'
import { TriangleAlert } from 'lucide-react'
import { TONE_TEXT, warningTone } from '@/lib/travel/itinerary-display'
import { cn } from '@/lib/utils'

/** Quiet, in line with the thing it is about. Never a dialog: a late arrival is worth knowing, not stopping for. */
export function SlotWarnings({ warnings, className }: { warnings: readonly ItineraryWarningValue[]; className?: string }) {
  if (warnings.length === 0) return null
  return (
    <ul className={cn('flex flex-col gap-0.5', className)}>
      {warnings.map(warning => (
        <li
          key={`${warning.kind}-${warning.optionId ?? ''}`}
          className={cn('flex items-start gap-1.5 text-xs', TONE_TEXT[warningTone(warning.kind)])}
        >
          <TriangleAlert aria-hidden className='mt-px size-3.5 shrink-0' />
          {warning.message}
        </li>
      ))}
    </ul>
  )
}
