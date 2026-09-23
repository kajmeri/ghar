import { createManualAccount, listManualAccounts } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as networth from '@/lib/networth/service'

export const GET = authedRoute(listManualAccounts, ({ query }, session) => networth.listManualAccountsPage(session, query))

export const POST = authedRoute(
  createManualAccount,
  async ({ body }, session) => ({ account: await networth.createManualAccount(session, body) }),
  { status: 201 }
)
