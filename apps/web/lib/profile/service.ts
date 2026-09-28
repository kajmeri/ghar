import 'server-only'
import type { Profile, ProfileBody } from '@ghar/contracts'
import * as queries from '@ghar/db/queries'
import type { SessionContext } from '@ghar/db/queries'
import { getDb } from '@/lib/db'

export async function getMyProfile(session: SessionContext): Promise<Profile> {
  return queries.getProfile(session, getDb())
}

export async function updateMyProfile(session: SessionContext, body: ProfileBody): Promise<Profile> {
  await queries.updateProfile(session, getDb(), { fullName: body.fullName })
  return { fullName: body.fullName }
}
