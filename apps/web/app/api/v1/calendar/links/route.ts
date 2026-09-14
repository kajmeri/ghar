import { listCalendarLinks } from '@ghar/contracts';
import { route } from '@/lib/api/handler';
import { getRequestContext } from '@/lib/auth/context';
import * as calendar from '@/lib/calendar/service';

export const GET = route(listCalendarLinks, async () => ({
  links: await calendar.listCalendarLinks(await getRequestContext()),
}));
