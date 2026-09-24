import { suggestSharedOption } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as guests from '@/lib/travel/guests'

export const POST = route(
  suggestSharedOption,
  async ({ params, body }) => ({ trip: await guests.suggestSharedOption(await requireAccountSession(), { ...params, suggestion: body }) }),
  { status: 201 }
)
