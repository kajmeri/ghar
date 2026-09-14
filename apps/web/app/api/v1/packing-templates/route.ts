import { createPackingTemplate, listPackingTemplates } from '@casa/contracts';
import {
  createPackingTemplate as insertTemplate,
  listPackingTemplates as selectTemplates,
} from '@casa/db/queries';
import { authedRoute } from '@/lib/api/authed';
import { getDb } from '@/lib/db';
import { toPackingTemplate } from '@/lib/travel/serialize';

export const GET = authedRoute(listPackingTemplates, async (_input, { context }) => ({
  templates: (await selectTemplates(getDb(), context)).map(toPackingTemplate),
}));

export const POST = authedRoute(
  createPackingTemplate,
  async ({ body }, { context }) => ({
    template: toPackingTemplate(await insertTemplate(getDb(), context, body)),
  }),
  { status: 201 },
);
