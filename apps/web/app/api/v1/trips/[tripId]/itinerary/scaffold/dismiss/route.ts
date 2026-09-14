import { dismissScaffold } from '@ghar/contracts'
import { dismissScaffold as dismiss } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'

export const POST = authedRoute(dismissScaffold, async ({ params, body }, { context }) => {
  await dismiss(context, getDb(), params.tripId, body.day)
  return { dismissed: true } as const
})
