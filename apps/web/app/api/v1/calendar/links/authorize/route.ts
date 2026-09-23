import { authorizeCalendarLink } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { createCalendarAuthorizationUrl } from '@/lib/calendar/oauth'

// Starts linking the signed-in person's Google Calendar from the phone. The app opens the URL in a
// browser; Google returns to /api/calendar/google/callback, which sends the browser on to `returnTo`.

export const POST = authedRoute(authorizeCalendarLink, ({ body }, session) => ({
  authorizationUrl: createCalendarAuthorizationUrl(session.context, { returnTo: body.returnTo }),
}))
