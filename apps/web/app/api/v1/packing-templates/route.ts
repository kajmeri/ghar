import { createPackingTemplate, listPackingTemplates } from '@ghar/contracts';
import {
  createPackingTemplate as insertTemplate,
  listPackingTemplates as selectTemplates,
} from '@ghar/db/queries';
import { authedRoute } from '@/lib/api/authed';
import { getDb } from '@/lib/db';
import { toPackingTemplate } from '@/lib/travel/serialize';

export const GET = authedRoute(listPackingTemplates, async (_input, { context }) => ({
  templates: (await selectTemplates(context, getDb())).map(toPackingTemplate),
}));

export const POST = authedRoute(
  createPackingTemplate,
  async ({ body }, { context }) => ({
    template: toPackingTemplate(await insertTemplate(context, getDb(), body)),
  }),
  { status: 201 },
);
