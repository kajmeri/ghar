import { syncBankConnection } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { syncConnection } from '@/lib/banking/connect'
import { readBankConnection } from '@/lib/banking/service'

export const POST = authedRoute(syncBankConnection, async ({ params }, { context }) => {
  const { connection, sync } = await syncConnection(context, { itemId: params.itemId })
  return { connection: await readBankConnection(context, connection), sync }
})
