import { respondToEvent } from '@ghar/contracts';
import { route } from '@/lib/api/handler';
import { getRequestContext } from '@/lib/auth/context';
import * as calendar from '@/lib/calendar/service';

export const PUT = route(respondToEvent, async ({ params, body }) => ({
  event: await calendar.respondToEvent(await getRequestContext(), {
    eventId: params.eventId,
    response: body.response,
  }),
}));
