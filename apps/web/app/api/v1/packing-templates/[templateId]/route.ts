import { deletePackingTemplate } from '@ghar/contracts'
import { deletePackingTemplate as removeTemplate } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'

export const DELETE = authedRoute(deletePackingTemplate, async ({ params }, { context }) => {
  await removeTemplate(context, getDb(), params.templateId)
  return { deleted: true } as const
})
