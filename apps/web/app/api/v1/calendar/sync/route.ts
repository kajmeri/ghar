import { syncCalendars } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { getRequestContext } from '@/lib/auth/context'
import * as calendar from '@/lib/calendar/service'

export const maxDuration = 120

export const POST = route(syncCalendars, async () => ({
  results: await calendar.syncHouseholdCalendars(await getRequestContext()),
}))
