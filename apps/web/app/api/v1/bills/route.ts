import { createBill, listBills } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as bills from '@/lib/bills/service'

export const GET = authedRoute(listBills, ({ query }, session) => bills.listBillsPage(session, query))

export const POST = authedRoute(createBill, async ({ body }, session) => ({ bill: await bills.createBill(session, body) }), {
  status: 201,
})
