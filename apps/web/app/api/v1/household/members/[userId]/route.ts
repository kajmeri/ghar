import { updateHouseholdMember } from '@casa/contracts';
import { updateHouseholdMember as patchMember } from '@casa/db/queries';
import { authedRoute } from '@/lib/api/authed';
import { getDb } from '@/lib/db';
import { toHouseholdMember } from '@/lib/travel/serialize';

export const PATCH = authedRoute(updateHouseholdMember, async ({ params, body }, { context }) => ({
  member: toHouseholdMember(await patchMember(getDb(), context, params.userId, body)),
}));
