import { saveHealthScan } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { saveHealthScan as save } from '@/lib/health/scan'

// Saves the records someone checked from a scan, and keeps the file if they asked, all together.
export const POST = authedRoute(saveHealthScan, ({ body }, session) => save(session, body))
