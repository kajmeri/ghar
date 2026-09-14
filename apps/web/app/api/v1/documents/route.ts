import { createDocument, listDocuments } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as documents from '@/lib/documents/service'

export const GET = authedRoute(listDocuments, async ({ query }, session) => ({
  documents: await documents.listDocuments(session, query),
}))

export const POST = authedRoute(
  createDocument,
  async ({ body }, session) => ({ document: await documents.createDocument(session, body) }),
  { status: 201 }
)
