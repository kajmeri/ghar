import { deleteEvent, getEvent, updateEvent } from '@ghar/contracts';
import { route } from '@/lib/api/handler';
import { getRequestContext } from '@/lib/auth/context';
import * as calendar from '@/lib/calendar/service';

export const GET = route(getEvent, async ({ params }) => ({
  event: await calendar.getEvent(await getRequestContext(), { eventId: params.eventId }),
}));

export const PUT = route(updateEvent, async ({ params, body }) => ({
  event: await calendar.updateEvent(await getRequestContext(), {
    ...calendar.eventInputFromBody(body),
    eventId: params.eventId,
  }),
}));

export const DELETE = route(deleteEvent, async ({ params }) =>
  calendar.deleteEvent(await getRequestContext(), { eventId: params.eventId }),
);
