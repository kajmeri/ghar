import { deleteCalendarLink } from '@ghar/contracts';
import { route } from '@/lib/api/handler';
import { getRequestContext } from '@/lib/auth/context';
import * as calendar from '@/lib/calendar/service';

export const DELETE = route(deleteCalendarLink, async ({ params }) =>
  calendar.disconnectCalendarLink(await getRequestContext(), { linkId: params.linkId }),
);
