import { sendDigestPreview } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { getRequestContext } from '@/lib/auth/context'
import * as digest from '@/lib/digest/service'

export const POST = route(sendDigestPreview, async () => digest.sendMyDigestPreview(await getRequestContext()))
