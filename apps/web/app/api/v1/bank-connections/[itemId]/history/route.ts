import { deleteBankConnectionHistory } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { deleteConnectionHistory } from '@/lib/banking/connect'
import { readBankConnection } from '@/lib/banking/service'

export const DELETE = authedRoute(deleteBankConnectionHistory, async ({ params }, { context }) => {
  const { connection, removed } = await deleteConnectionHistory(context, { itemId: params.itemId })
  return { connection: await readBankConnection(context, connection), removed }
})
