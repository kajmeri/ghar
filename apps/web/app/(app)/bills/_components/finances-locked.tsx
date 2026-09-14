import { EmptyState } from '@/app/(app)/_components/ui/empty-state'
import { LockIllustration } from '@/app/(app)/_components/ui/illustrations'

/** What someone who can't see money gets instead of a bill. */
export function FinancesLocked() {
  return (
    <EmptyState
      illustration={<LockIllustration />}
      title='Money is for owners and adults'
      description='Ask an owner to change your role if you need to see bills and whether they’re paid.'
    />
  )
}
