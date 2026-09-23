import { createAsset, listAssets } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as home from '@/lib/home/service'

export const GET = authedRoute(listAssets, ({ query }, session) => home.listAssetsPage(session, query))

export const POST = authedRoute(createAsset, async ({ body }, session) => ({ asset: await home.createAsset(session, body) }), {
  status: 201,
})
