import { listNetWorthHistory, saveNetWorthHistory } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as networth from '@/lib/networth/service'

export const GET = authedRoute(listNetWorthHistory, ({ query }, session) => networth.listNetWorthHistoryPage(session, query))

export const POST = authedRoute(
  saveNetWorthHistory,
  async ({ body }, session) => ({ entry: await networth.saveNetWorthHistory(session, body) }),
  { status: 201 }
)
