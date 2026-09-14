import { promoteTripIdea } from '@casa/contracts';
import { promoteTripIdea as promote } from '@casa/db/queries';
import { authedRoute } from '@/lib/api/authed';
import { getDb } from '@/lib/db';

export const POST = authedRoute(
  promoteTripIdea,
  async ({ params, body }, { context }) => {
    const trip = await promote(getDb(), context, params.ideaId, body);
    return { tripId: trip.id };
  },
  { status: 201 },
);
