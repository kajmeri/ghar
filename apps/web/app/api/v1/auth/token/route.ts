import { issueToken } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import * as apiTokens from '@/lib/auth/api-tokens'

// Public: the grant in the body is the credential.
export const POST = route(issueToken, async ({ body }) => apiTokens.issueToken(body))
