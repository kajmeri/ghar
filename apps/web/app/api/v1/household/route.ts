import { getHousehold } from '@casa/contracts';
import { listHouseholdMembers } from '@casa/db/queries';
import { authedRoute } from '@/lib/api/authed';
import { getDb } from '@/lib/db';
import { toHouseholdMember } from '@/lib/travel/serialize';

/** Who is in the household, and what it calls them. The only source of a person's name. */
export const GET = authedRoute(getHousehold, async (_input, { context, household }) => ({
  household: {
    id: household.id,
    name: household.name,
    timeZone: household.timeZone,
    members: (await listHouseholdMembers(getDb(), context)).map(toHouseholdMember),
  },
  currentUserId: context.userId,
}));
