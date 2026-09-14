'use client'

import { Rows2, Rows3 } from 'lucide-react'
import { useItinerary } from './itinerary-context'

const BUTTON =
  'flex size-tap items-center justify-center text-ink-muted hover:bg-paper aria-pressed:bg-paper aria-pressed:text-ink [&_svg]:size-5'

/** One line per slot, or a second line with where and what. Remembered per person. */
export function DensityToggle() {
  const { density, setDensity } = useItinerary()
  return (
    <div role='group' aria-label='Row spacing' className='flex overflow-hidden rounded-control border border-line bg-surface'>
      <button
        type='button'
        aria-pressed={density === 'compact'}
        className={BUTTON}
        onClick={() => {
          setDensity('compact')
        }}
      >
        <Rows3 aria-hidden />
        <span className='sr-only'>Compact</span>
      </button>
      <button
        type='button'
        aria-pressed={density === 'comfortable'}
        className={`${BUTTON} border-l border-line`}
        onClick={() => {
          setDensity('comfortable')
        }}
      >
        <Rows2 aria-hidden />
        <span className='sr-only'>Comfortable</span>
      </button>
    </div>
  )
}
