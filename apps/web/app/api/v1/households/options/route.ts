import { getHouseholdOptions } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireSession } from '@/lib/auth/context'
import { householdOptions } from '@/lib/households/options'

// Signed in, but not yet in a household: this is what the create-household form needs, so it
// can't go through authedRoute, which requires one.
export const GET = route(getHouseholdOptions, async () => {
  await requireSession()
  return householdOptions()
})
