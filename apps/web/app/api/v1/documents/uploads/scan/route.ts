import { scanDocumentUpload } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { scanUploadedFile } from '@/lib/documents/scan'

// Reads the dates off a file that's uploaded but not yet saved as a document. Suggestions only.
export const POST = authedRoute(scanDocumentUpload, ({ body }, session) => scanUploadedFile(session, body.storagePath))
