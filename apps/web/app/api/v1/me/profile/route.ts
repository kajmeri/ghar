import { getMyProfile, updateMyProfile } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireSession } from '@/lib/auth/context'
import * as profile from '@/lib/profile/service'

export const GET = route(getMyProfile, async () => ({ profile: await profile.getMyProfile(await requireSession()) }))

export const PATCH = route(updateMyProfile, async ({ body }) => ({ profile: await profile.updateMyProfile(await requireSession(), body) }))
