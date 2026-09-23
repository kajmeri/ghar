import { markBillPaid } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as bills from '@/lib/bills/service'

export const POST = authedRoute(markBillPaid, ({ params, body }, session) => bills.markBillPaid(session, params.billId, body))
