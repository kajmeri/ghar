import { createTripIdea, listTripIdeas } from '@casa/contracts';
import {
  createTripIdea as insertIdea,
  listTripIdeas as selectIdeas,
} from '@casa/db/queries';
import { authedRoute } from '@/lib/api/authed';
import { getDb } from '@/lib/db';
import { toTripIdea } from '@/lib/travel/serialize';

export const GET = authedRoute(listTripIdeas, async (_input, { context }) => ({
  ideas: (await selectIdeas(getDb(), context)).map(toTripIdea),
}));

export const POST = authedRoute(
  createTripIdea,
  async ({ body }, { context }) => ({
    idea: toTripIdea(await insertIdea(getDb(), context, body)),
  }),
  { status: 201 },
);
