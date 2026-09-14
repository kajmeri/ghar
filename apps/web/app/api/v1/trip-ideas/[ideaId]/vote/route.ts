import { voteOnTripIdea } from '@casa/contracts';
import { voteOnTripIdea as castVote } from '@casa/db/queries';
import { authedRoute } from '@/lib/api/authed';
import { getDb } from '@/lib/db';
import { toTripIdea } from '@/lib/travel/serialize';

export const POST = authedRoute(voteOnTripIdea, async ({ params, body }, { context }) => ({
  idea: toTripIdea(await castVote(getDb(), context, params.ideaId, body.vote)),
}));
