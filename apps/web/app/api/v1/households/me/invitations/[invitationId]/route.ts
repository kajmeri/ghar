import { revokeInvitation } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { getRequestContext } from '@/lib/auth/context'
import * as households from '@/lib/households/service'

export const DELETE = route(revokeInvitation, async ({ params }) =>
  households.revokeInvitation(await getRequestContext(), { invitationId: params.invitationId })
)
