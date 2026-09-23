import type * as React from 'react'
import { cn } from '@/lib/utils'

const TONES = {
  neutral: 'border-line text-ink-muted',
  positive: 'border-positive/30 text-positive',
  caution: 'border-caution/40 text-caution-ink',
  negative: 'border-negative/30 text-negative',
} as const

export type PillTone = keyof typeof TONES

/** A 999px label. Colour only when it says something about money or state. */
export function Pill({ tone = 'neutral', className, ...props }: React.ComponentProps<'span'> & { tone?: PillTone }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-pill border px-2.5 py-0.5 text-xs', TONES[tone], className)} {...props} />
  )
}
