import { listMembers } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { getRequestContext } from '@/lib/auth/context'
import * as households from '@/lib/households/service'

export const GET = route(listMembers, async () => ({
  members: await households.listMembers(await getRequestContext()),
}))
