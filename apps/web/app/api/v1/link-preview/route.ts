import { previewLink } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { getOpenGraphProvider } from '@/lib/providers/opengraph'

/** Reads a pasted link's OpenGraph tags. Signed in only: it makes a request on our behalf. */
export const POST = authedRoute(previewLink, async ({ body }) => ({
  preview: await getOpenGraphProvider().fetchPreview(body.url),
}))
