import { discardDocumentUpload } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { discardUpload } from '@/lib/documents/scan'

export const POST = authedRoute(discardDocumentUpload, ({ body }, session) => discardUpload(session, body.storagePath))
