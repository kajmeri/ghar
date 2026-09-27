import { acceptMyInvitation } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireSession } from '@/lib/auth/context'
import * as households from '@/lib/households/service'

export const POST = route(acceptMyInvitation, async ({ params }) =>
  households.acceptMyInvitation(await requireSession(), params.invitationId)
)
