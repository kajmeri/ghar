import { listMailBookingDrafts } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { getRequestContext } from '@/lib/auth/context'
import * as mail from '@/lib/mail/service'

export const GET = route(listMailBookingDrafts, async ({ query }) => mail.listDraftsPage(await getRequestContext(), query))
