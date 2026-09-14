import { cn } from '@/lib/utils'

/** The loading state. Motion only in response to a user action, so this does not pulse. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('rounded-control bg-line/60', className)} aria-hidden />
}
