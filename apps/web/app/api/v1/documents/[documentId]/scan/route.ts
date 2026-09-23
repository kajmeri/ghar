import { scanDocument } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { scanSavedDocument } from '@/lib/documents/scan'

// Reads the dates off a saved document's file. Suggestions only; nothing about the document changes.
export const POST = authedRoute(scanDocument, ({ params }, session) => scanSavedDocument(session, params.documentId))
