import { deleteSharedOption } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as guests from '@/lib/travel/guests'

export const DELETE = route(deleteSharedOption, async ({ params }) => ({
  trip: await guests.deleteSharedOption(await requireAccountSession(), params),
}))
