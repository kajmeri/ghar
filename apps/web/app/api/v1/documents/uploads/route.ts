import { createDocumentUpload } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as documents from '@/lib/documents/service'

// Step one of adding a document. The file goes straight from the phone to the private bucket,
// then POST /api/v1/documents saves it.
export const POST = authedRoute(
  createDocumentUpload,
  async ({ body }, session) => ({ upload: await documents.createDocumentUpload(session, body) }),
  { status: 201 }
)
