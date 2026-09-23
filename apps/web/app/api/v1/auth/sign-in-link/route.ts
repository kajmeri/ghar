import { requestSignInLink } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import * as apiTokens from '@/lib/auth/api-tokens'

// Public: this is how a signed-out phone starts signing in.
export const POST = route(requestSignInLink, async ({ body }) => apiTokens.requestSignInLink(body))
