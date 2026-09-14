import { getMyHousehold } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { getRequestContext, requireSession } from '@/lib/auth/context'
import * as households from '@/lib/households/service'

export const GET = route(getMyHousehold, async () => {
  const session = await requireSession()
  return households.getMyHousehold(await getRequestContext(), session)
})
