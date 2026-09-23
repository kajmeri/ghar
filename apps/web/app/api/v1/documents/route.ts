import { createDocument, listDocuments } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as documents from '@/lib/documents/service'

export const GET = authedRoute(listDocuments, ({ query }, session) => documents.listDocumentsPage(session, query))

export const POST = authedRoute(
  createDocument,
  async ({ body }, session) => ({ document: await documents.createDocument(session, body) }),
  { status: 201 }
)
