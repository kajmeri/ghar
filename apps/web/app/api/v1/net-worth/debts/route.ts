import { listDebts } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as networth from '@/lib/networth/service'

export const GET = authedRoute(listDebts, (_input, session) => networth.listDebts(session))
