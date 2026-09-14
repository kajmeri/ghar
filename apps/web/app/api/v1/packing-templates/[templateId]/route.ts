import { deletePackingTemplate } from '@casa/contracts';
import { deletePackingTemplate as removeTemplate } from '@casa/db/queries';
import { authedRoute } from '@/lib/api/authed';
import { getDb } from '@/lib/db';

export const DELETE = authedRoute(deletePackingTemplate, async ({ params }, { context }) => {
  await removeTemplate(getDb(), context, params.templateId);
  return { deleted: true } as const;
});
