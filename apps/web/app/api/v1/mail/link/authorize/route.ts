import { authorizeMailLink } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { createMailAuthorizationUrl } from '@/lib/mail/oauth'

// Starts linking the signed-in person's Gmail, read-only, from the phone. The app opens the URL in a
// browser; Google returns to /api/mail/google/callback, which sends the browser on to `returnTo`.

export const POST = authedRoute(authorizeMailLink, ({ body }, session) => ({
  authorizationUrl: createMailAuthorizationUrl(session.context, { returnTo: body.returnTo }),
}))
