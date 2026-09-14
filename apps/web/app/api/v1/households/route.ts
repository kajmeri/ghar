import { createHousehold } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireSession } from '@/lib/auth/context'
import * as households from '@/lib/households/service'

export const POST = route(createHousehold, async ({ body }) => households.createHousehold(await requireSession(), body), { status: 201 })
