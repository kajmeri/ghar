import { deleteAsset, getAsset, updateAsset } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as home from '@/lib/home/service'

export const GET = authedRoute(getAsset, ({ params }, session) => home.getAssetDetail(session, params.assetId))

export const PUT = authedRoute(updateAsset, async ({ params, body }, session) => ({
  asset: await home.updateAsset(session, params.assetId, body),
}))

export const DELETE = authedRoute(deleteAsset, ({ params }, session) => home.deleteAsset(session, params.assetId))
