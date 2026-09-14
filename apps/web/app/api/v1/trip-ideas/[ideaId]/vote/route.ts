import { voteOnTripIdea } from '@ghar/contracts';
import { voteOnTripIdea as castVote } from '@ghar/db/queries';
import { authedRoute } from '@/lib/api/authed';
import { getDb } from '@/lib/db';
import { toTripIdea } from '@/lib/travel/serialize';

export const POST = authedRoute(voteOnTripIdea, async ({ params, body }, { context }) => ({
  idea: toTripIdea(await castVote(context, getDb(), params.ideaId, body.vote)),
}));
