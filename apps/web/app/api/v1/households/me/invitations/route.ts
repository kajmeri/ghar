import { createInvitation, listInvitations } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { getRequestContext, requireSession } from '@/lib/auth/context'
import * as households from '@/lib/households/service'

export const GET = route(listInvitations, async ({ query }) => households.listInvitationsPage(await getRequestContext(), query))

export const POST = route(
  createInvitation,
  async ({ body }) => {
    const session = await requireSession()
    const ctx = await getRequestContext()
    return households.inviteMember(ctx, session, body)
  },
  { status: 201 }
)
