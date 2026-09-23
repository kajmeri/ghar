import { documentParamsSchema } from '@ghar/contracts'
import { NotFoundError } from '@ghar/core/errors'
import { requireSession } from '@/lib/api/authed'
import { errorResponse } from '@/lib/api/errors'
import * as documents from '@/lib/documents/service'

/**
 * Opens a document's file: signs a short-lived URL and redirects to it. A link can point here and
 * open in a new tab, which phones allow, where a URL fetched first and opened by script is blocked.
 * The signed URL is never cached and never sent on as a referrer.
 */
export async function GET(request: Request, { params }: RouteContext<'/documents/[documentId]/file'>) {
  const requestId = crypto.randomUUID()
  try {
    const parsed = documentParamsSchema.safeParse(await params)
    if (!parsed.success) throw new NotFoundError('Document not found')
    const { url } = await documents.getDocumentFileUrl(await requireSession(), parsed.data.documentId)
    return new Response(null, {
      status: 303,
      headers: {
        Location: new URL(url, request.url).toString(),
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'x-request-id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, { request })
  }
}
