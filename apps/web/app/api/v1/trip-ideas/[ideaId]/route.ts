import { deleteTripIdea } from '@ghar/contracts'
import { deleteTripIdea as removeIdea } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'

export const DELETE = authedRoute(deleteTripIdea, async ({ params }, { context }) => {
  await removeIdea(context, getDb(), params.ideaId)
  return { deleted: true } as const
})
