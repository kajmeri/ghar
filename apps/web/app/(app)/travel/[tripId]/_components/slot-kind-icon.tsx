import type { SlotKind } from '@ghar/core/itinerary'
import { BedDouble, Coffee, StickyNote, Ticket, TrainFront, Utensils, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

const ICONS: Record<SlotKind, LucideIcon> = {
  meal: Utensils,
  activity: Ticket,
  transport: TrainFront,
  lodging: BedDouble,
  downtime: Coffee,
  note: StickyNote,
}

export function SlotKindIcon({ kind, className }: { kind: SlotKind; className?: string }) {
  const Icon = ICONS[kind]
  return <Icon aria-hidden className={cn('size-4 shrink-0 text-ink-muted', className)} />
}
