import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

const CIRCLE = 'flex size-10 shrink-0 items-center justify-center rounded-pill border border-line bg-paper'

/** A person's initials. Decorative: their name is always written next to it. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span aria-hidden className={cn(CIRCLE, 'text-sm font-medium text-ink', className)}>
      {initials(name)}
    </span>
  )
}

/** An icon in the avatar's circle, for rows that aren't people: an account, a category. */
export function IconAvatar({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span aria-hidden className={cn(CIRCLE, className)}>
      <Icon className='size-5 text-ink-muted' />
    </span>
  )
}

function initials(name: string): string {
  const words = name.split('@')[0]?.trim().split(/\s+/).filter(Boolean) ?? []
  const letters = words.length > 1 ? [words[0], words.at(-1)] : words.slice(0, 1)
  return letters
    .map(word => Array.from(word ?? '')[0] ?? '')
    .join('')
    .toUpperCase()
}
