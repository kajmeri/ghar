import { deleteTripIdea } from '@casa/contracts';
import { deleteTripIdea as removeIdea } from '@casa/db/queries';
import { authedRoute } from '@/lib/api/authed';
import { getDb } from '@/lib/db';

export const DELETE = authedRoute(deleteTripIdea, async ({ params }, { context }) => {
  await removeIdea(getDb(), context, params.ideaId);
  return { deleted: true } as const;
});
