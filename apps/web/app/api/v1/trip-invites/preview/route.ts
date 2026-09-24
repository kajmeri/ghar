import { previewTripInvite } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { getSessionContext } from '@/lib/auth/context'
import * as guests from '@/lib/travel/guests'

// Public: the invitation shows the same safe preview to anyone holding the link. Signed in, it
// also says whether they've answered.
export const POST = route(previewTripInvite, async ({ body }) => ({
  invite: await guests.previewTripInvite(await getSessionContext(), body.token),
}))
