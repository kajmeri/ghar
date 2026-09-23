import { unmarkBillPaid } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as bills from '@/lib/bills/service'

export const DELETE = authedRoute(unmarkBillPaid, ({ params }, session) => bills.unmarkBillPaid(session, params.billId, params.dueOn))
