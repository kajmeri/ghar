import { createPackingTemplate, listPackingTemplates } from '@ghar/contracts'
import { createPackingTemplate as insertTemplate } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { toPackingTemplate } from '@/lib/travel/serialize'
import { loadPackingTemplatesPage } from '@/lib/travel/trips'

export const GET = authedRoute(listPackingTemplates, ({ query }, session) => loadPackingTemplatesPage(session, query))

export const POST = authedRoute(
  createPackingTemplate,
  async ({ body }, { context }) => ({
    template: toPackingTemplate(await insertTemplate(context, getDb(), body)),
  }),
  { status: 201 }
)
