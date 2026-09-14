import { getDocumentFileUrl } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as documents from '@/lib/documents/service'

// A short-lived signed link to the file. Ask for a new one each time it's opened; never store it.
export const GET = authedRoute(getDocumentFileUrl, ({ params }, session) => documents.getDocumentFileUrl(session, params.documentId))
