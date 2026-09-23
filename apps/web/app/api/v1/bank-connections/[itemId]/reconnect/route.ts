import { reconnectBankConnection } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { completeReconnect } from '@/lib/banking/connect'
import { readBankConnection } from '@/lib/banking/service'

export const POST = authedRoute(reconnectBankConnection, async ({ params }, { context }) => {
  const { connection, sync } = await completeReconnect(context, { itemId: params.itemId })
  return { connection: await readBankConnection(context, connection), sync }
})
