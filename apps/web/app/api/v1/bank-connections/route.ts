import { createBankConnection, listBankConnections } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { completeLink } from '@/lib/banking/connect'
import { listConnections, readBankConnection } from '@/lib/banking/service'

export const GET = authedRoute(listBankConnections, (_input, { context }) => listConnections(context))

export const POST = authedRoute(
  createBankConnection,
  async ({ body }, { context }) => {
    const { connection, sync } = await completeLink(context, { publicToken: body.publicToken })
    return { connection: await readBankConnection(context, connection), sync }
  },
  { status: 201 }
)
