import { deleteDocument, getDocument, updateDocument } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as documents from '@/lib/documents/service'

export const GET = authedRoute(getDocument, async ({ params }, session) => ({
  document: await documents.getDocument(session, params.documentId),
}))

export const PUT = authedRoute(updateDocument, async ({ params, body }, session) => ({
  document: await documents.updateDocument(session, params.documentId, body),
}))

export const DELETE = authedRoute(deleteDocument, ({ params }, session) => documents.deleteDocument(session, params.documentId))
