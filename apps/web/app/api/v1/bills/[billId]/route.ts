import { deleteBill, getBill, updateBill } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as bills from '@/lib/bills/service'

export const GET = authedRoute(getBill, ({ params }, session) => bills.getBillDetail(session, params.billId))

export const PUT = authedRoute(updateBill, async ({ params, body }, session) => ({
  bill: await bills.updateBill(session, params.billId, body),
}))

export const DELETE = authedRoute(deleteBill, ({ params }, session) => bills.deleteBill(session, params.billId))
