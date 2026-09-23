import 'server-only'
import type { DigestPreferencesBody, DigestSettings } from '@ghar/contracts'
import { DIGEST_SECTIONS, digestSectionsFor, type DigestPreferences } from '@ghar/core/digest'
import * as queries from '@ghar/db/queries'
import type { RequestContext } from '@ghar/db/queries'
import { getDb } from '@/lib/db'

// How the signed-in person gets their own daily email. What's sent is in ./service.

async function toSettings(ctx: RequestContext, preferences: DigestPreferences): Promise<DigestSettings> {
  const { timezone } = await queries.getHousehold(ctx, getDb())
  return {
    preferences: { ...preferences, sections: [...preferences.sections] },
    timezone,
    availableSections: digestSectionsFor(ctx.role, DIGEST_SECTIONS),
  }
}

export async function getDigestSettings(ctx: RequestContext): Promise<DigestSettings> {
  return toSettings(ctx, await queries.getDigestPreferences(ctx, getDb()))
}

export async function updateDigestSettings(ctx: RequestContext, body: DigestPreferencesBody): Promise<DigestSettings> {
  return toSettings(ctx, await queries.setDigestPreferences(ctx, getDb(), body))
}
