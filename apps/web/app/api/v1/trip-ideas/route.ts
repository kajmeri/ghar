import { createTripIdea, listTripIdeas } from '@ghar/contracts'
import { createTripIdea as insertIdea, listTripIdeas as selectIdeas } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { toTripIdea } from '@/lib/travel/serialize'

export const GET = authedRoute(listTripIdeas, async (_input, { context }) => ({
  ideas: (await selectIdeas(context, getDb())).map(toTripIdea),
}))

export const POST = authedRoute(
  createTripIdea,
  async ({ body }, { context }) => ({
    idea: toTripIdea(await insertIdea(context, getDb(), body)),
  }),
  { status: 201 }
)
