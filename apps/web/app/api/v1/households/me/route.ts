import { getMyHousehold, updateMyHousehold } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { getRequestContext, requireSession } from '@/lib/auth/context'
import * as households from '@/lib/households/service'

export const GET = route(getMyHousehold, async () => {
  const session = await requireSession()
  return households.getMyHousehold(await getRequestContext(), session)
})

export const PATCH = route(updateMyHousehold, async ({ body }) => {
  const session = await requireSession()
  return households.updateMyHousehold(await getRequestContext(), session, body)
})
