import { getAuthSession } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import * as apiTokens from '@/lib/auth/api-tokens'
import { requireSession } from '@/lib/auth/context'

// A session, not a household, so a client can learn it needs to refresh.
export const GET = route(getAuthSession, async () => apiTokens.describeSession(await requireSession()))
