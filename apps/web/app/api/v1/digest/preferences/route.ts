import { getDigestPreferences, updateDigestPreferences } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { getRequestContext } from '@/lib/auth/context'
import * as digest from '@/lib/digest/preferences'

export const GET = route(getDigestPreferences, async () => digest.getDigestSettings(await getRequestContext()))

export const PUT = route(updateDigestPreferences, async ({ body }) => digest.updateDigestSettings(await getRequestContext(), body))
