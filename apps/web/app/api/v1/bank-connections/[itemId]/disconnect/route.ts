import { disconnectBankConnection } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { disconnectConnection } from '@/lib/banking/connect'
import { readBankConnection } from '@/lib/banking/service'

export const POST = authedRoute(disconnectBankConnection, async ({ params }, { context }) => {
  const connection = await disconnectConnection(context, { itemId: params.itemId })
  return { connection: await readBankConnection(context, connection) }
})
