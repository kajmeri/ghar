import { createEvent } from '@ghar/contracts';
import { route } from '@/lib/api/handler';
import { getRequestContext } from '@/lib/auth/context';
import * as calendar from '@/lib/calendar/service';

export const POST = route(
  createEvent,
  async ({ body }) => ({
    event: await calendar.createEvent(
      await getRequestContext(),
      calendar.eventInputFromBody(body),
    ),
  }),
  { status: 201 },
);
