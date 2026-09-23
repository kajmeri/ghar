import { createTripIdea, listTripIdeas } from '@ghar/contracts'
import { createTripIdea as insertIdea } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { toTripIdea } from '@/lib/travel/serialize'
import { loadTripIdeasPage } from '@/lib/travel/trips'

export const GET = authedRoute(listTripIdeas, ({ query }, session) => loadTripIdeasPage(session, query))

export const POST = authedRoute(
  createTripIdea,
  async ({ body }, { context }) => ({
    idea: toTripIdea(await insertIdea(context, getDb(), body)),
  }),
  { status: 201 }
)
