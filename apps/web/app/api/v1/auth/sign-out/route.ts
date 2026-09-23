import { signOut } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import * as apiTokens from '@/lib/auth/api-tokens'
import { requireSession } from '@/lib/auth/context'

// A session, not a household: a token from before onboarding, or one whose household has changed, can still sign out.
export const POST = route(signOut, async () => apiTokens.signOut(await requireSession()))
