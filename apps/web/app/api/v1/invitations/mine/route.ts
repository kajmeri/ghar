import { listMyInvitations } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireSession } from '@/lib/auth/context'
import * as households from '@/lib/households/service'

export const GET = route(listMyInvitations, async () => ({ invitations: await households.listMyInvitations(await requireSession()) }))
