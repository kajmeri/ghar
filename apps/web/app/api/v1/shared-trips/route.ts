import { listSharedTrips } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as guests from '@/lib/travel/guests'

export const GET = route(listSharedTrips, async () => ({ trips: await guests.listSharedTrips(await requireAccountSession()) }))
